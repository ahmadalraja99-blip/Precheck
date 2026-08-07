import { Injectable, Logger, Optional } from '@nestjs/common';
import { Interval } from '@nestjs/schedule';
import { EmailStatus, OperationalReportEmailJob, OperationalReportEmailJobStatus,
  NotificationType, OperationalReportStatus, PermissionCode, Prisma } from '@prisma/client';
import { createHash, randomUUID } from 'crypto';
import { AuditService } from '../audit/audit.service';
import { MailerService } from '../mailer/mailer.service';
import { PrismaService } from '../prisma/prisma.service';
import { StorageService } from '../storage/storage.service';
import { OperationalFlightReportDataService } from './operational-flight-report-data.service';
import { OperationalReportEmailPolicyService } from './operational-report-email-policy.service';
import { NotificationsGateway, REALTIME_EVENTS } from '../notifications/notifications.gateway';
import { NotificationsService } from '../notifications/notifications.service';

@Injectable()
export class OperationalReportEmailJobsProcessor {
  private readonly logger = new Logger(OperationalReportEmailJobsProcessor.name);
  private readonly workerId = `${process.pid}-${randomUUID()}`;
  constructor(private readonly prisma: PrismaService, private readonly policy: OperationalReportEmailPolicyService,
    private readonly data: OperationalFlightReportDataService, private readonly storage: StorageService,
    private readonly mailer: MailerService, private readonly audit: AuditService,
    @Optional() private readonly realtime?: NotificationsGateway,
    @Optional() private readonly notifications?: NotificationsService) {}

  @Interval(Number(process.env.OPERATIONAL_REPORT_EMAIL_INTERVAL_MS ?? 30000))
  async tick() {
    if (!this.policy.enabled()) return;
    try { await this.recoverStaleJobs(); for (const job of await this.claimBatch()) await this.process(job); }
    catch (error) { this.logger.error(this.sanitize(error)); }
  }

  claimBatch() {
    return this.prisma.$queryRaw<OperationalReportEmailJob[]>(Prisma.sql`
      WITH candidates AS (
        SELECT "id" FROM "OperationalReportEmailJob"
        WHERE "nextAttemptAt" <= NOW() AND "attempts" < "maxAttempts"
          AND "status" IN ('PENDING'::"OperationalReportEmailJobStatus", 'FAILED'::"OperationalReportEmailJobStatus")
          AND "lockedAt" IS NULL ORDER BY "nextAttemptAt", "createdAt"
        FOR UPDATE SKIP LOCKED LIMIT ${this.policy.batchSize()}
      )
      UPDATE "OperationalReportEmailJob" job SET "status"='PROCESSING'::"OperationalReportEmailJobStatus",
        "lockedAt"=NOW(), "lockedBy"=${this.workerId}, "attempts"=job."attempts"+1, "updatedAt"=NOW()
      FROM candidates WHERE job."id"=candidates."id" RETURNING job.*`);
  }

  async recoverStaleJobs(now = new Date()) {
    const cutoff = new Date(now.getTime() - this.policy.staleLockMs());
    const stale = await this.prisma.operationalReportEmailJob.findMany({ where: {
      status: OperationalReportEmailJobStatus.PROCESSING, lockedAt: { lt: cutoff },
    } });
    for (const job of stale) {
      const recovered = await this.prisma.operationalReportEmailJob.updateMany({ where: { id: job.id,
        status: OperationalReportEmailJobStatus.PROCESSING, lockedAt: job.lockedAt }, data: {
        status: OperationalReportEmailJobStatus.PENDING, lockedAt: null, lockedBy: null, nextAttemptAt: now } });
      if (recovered.count === 1) await this.audit.record({ action: 'RECOVER_STALE_OPERATIONAL_REPORT_EMAIL_JOB',
        entityType: 'OperationalReportEmailJob', entityId: job.id, metadata: this.metadata(job) });
    }
    return stale.length;
  }

  async process(job: OperationalReportEmailJob) {
    await this.audit.record({ action: 'START_OPERATIONAL_REPORT_EMAIL_JOB', entityType: 'OperationalReportEmailJob',
      entityId: job.id, metadata: this.metadata(job) });
    try {
      const recipients = await this.policy.recipients(job.companyId);
      if (!recipients.to.length) {
        await this.prisma.operationalReportEmailJob.updateMany({ where: { id: job.id, lockedBy: this.workerId }, data: {
          status: OperationalReportEmailJobStatus.SKIPPED, completedAt: new Date(), lockedAt: null, lockedBy: null,
          lastError: 'No valid primary recipients were configured',
          recipientMetadata: { ...recipients, all: [...recipients.to, ...recipients.cc, ...recipients.bcc].join(',') },
        } });
        await this.audit.record({ action: 'SKIP_OPERATIONAL_REPORT_EMAIL_JOB', entityType: 'OperationalReportEmailJob',
          entityId: job.id, note: 'No valid primary recipients were configured', metadata: this.metadata(job) });
        return;
      }
      const attachments = await this.attachments(job);
      const reportData = await this.data.assemble(job.dailySessionFlightId);
      const { subject, body } = this.message(reportData);
      const recipientMetadata = { ...recipients, all: [...recipients.to, ...recipients.cc, ...recipients.bcc].join(',') };
      const attachmentMetadata = attachments.map((item) => ({ filename: item.filename, format: item.format,
        mimeType: item.mimeType, fileSize: item.fileSize, checksum: item.checksum }));
      await this.prisma.operationalReportEmailJob.updateMany({ where: { id: job.id, lockedBy: this.workerId },
        data: { subject, recipientMetadata, attachmentMetadata } });
      const log = await this.mailer.send({ to: recipients.to, cc: recipients.cc, bcc: recipients.bcc, subject, body,
        attachments: attachments.map(({ filename, path }) => ({ filename, path })),
        relatedEntityType: 'OperationalReportEmailJob', relatedEntityId: job.id });
      if (log.status !== EmailStatus.SENT) throw new Error(log.errorMessage ?? 'SMTP delivery failed');
      const completed = await this.prisma.operationalReportEmailJob.updateMany({ where: {
        id: job.id, status: OperationalReportEmailJobStatus.PROCESSING, lockedBy: this.workerId,
      }, data: { status: OperationalReportEmailJobStatus.COMPLETED, completedAt: new Date(), lockedAt: null,
        lockedBy: null, lastError: null } });
      if (completed.count !== 1) throw new Error('Operational report email job lock was lost');
      await this.audit.record({ action: 'COMPLETE_OPERATIONAL_REPORT_EMAIL_JOB', entityType: 'OperationalReportEmailJob',
        entityId: job.id, permissionUsed: PermissionCode.CAN_EXPORT_REPORTS,
        metadata: { ...this.metadata(job), emailLogId: log.id, attachmentNames: attachmentMetadata.map((item) => item.filename) } });
      this.realtime?.emitScoped(REALTIME_EVENTS.REPORT_EMAIL_JOB_STATUS, { resourceId: job.id, status: 'COMPLETED',
        companyId: job.companyId, dailySessionFlightId: job.dailySessionFlightId, updatedAt: new Date().toISOString() }, { admins: true });
    } catch (error) { await this.fail(job, error); }
  }

  private async attachments(job: OperationalReportEmailJob) {
    const formats = this.policy.requiredFormats();
    if (!formats.length) throw new Error('No report attachment formats are enabled');
    const reports = await this.prisma.flightReport.findMany({ where: { dailySessionFlightId: job.dailySessionFlightId,
      generationType: job.generationType, templateVersion: job.templateVersion, format: { in: formats } } });
    const flight = await this.prisma.dailySessionFlight.findUniqueOrThrow({ where: { id: job.dailySessionFlightId },
      select: { flight: { select: { flightNumber: true } } } });
    const safe = flight.flight.flightNumber.replace(/[^A-Za-z0-9_-]/g, '-');
    const result: Array<{ filename: string; path: string; format: typeof formats[number]; mimeType: string;
      fileSize: number; checksum: string }> = [];
    for (const format of formats) {
      const report = reports.find((item) => item.format === format);
      if (!report || report.status !== OperationalReportStatus.GENERATED || !report.filePath || !report.checksum || !report.mimeType)
        throw new Error(`${format} report attachment is not ready`);
      const expected = format === 'PDF' ? { ext: 'pdf', mime: 'application/pdf' }
        : { ext: 'xlsx', mime: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' };
      if (report.mimeType !== expected.mime || !report.filePath.toLowerCase().endsWith(`.${expected.ext}`))
        throw new Error(`${format} report attachment metadata is inconsistent`);
      const stored = await this.storage.assertFile(report.filePath);
      const bytes = await this.storage.read(report.filePath);
      if (createHash('sha256').update(bytes).digest('hex') !== report.checksum)
        throw new Error(`${format} report attachment integrity verification failed`);
      result.push({ filename: `${safe}-flight-report.${expected.ext}`, path: stored.fullPath, format,
        mimeType: expected.mime, fileSize: stored.size, checksum: report.checksum });
    }
    return result;
  }

  private message(data: Awaited<ReturnType<OperationalFlightReportDataService['assemble']>>) {
    const attempt = data.outCheck?.attempts.at(-1);
    const counters = data.reservations.map((item) => item.counterCode).join(', ') || '-';
    const formats = this.policy.requiredFormats().join(', ');
    const tz = 'Asia/Damascus';
    const date = (value: Date | null | undefined) => value ? new Intl.DateTimeFormat(this.policy.locale(),
      { dateStyle: 'medium', timeStyle: 'short', timeZone: tz }).format(value) : '-';
    if (this.policy.locale() === 'ar') return {
      subject: `تقرير الرحلة التشغيلي — ${data.flight.flightNumber} — ${data.company.name}`,
      body: [`شركة الطيران: ${data.company.name} (${data.company.code})`, `الرحلة: ${data.flight.flightNumber}`,
        `المسار: ${data.flight.origin} - ${data.flight.destination}`, `الطائرة: ${data.flight.aircraftType ?? '-'}`,
        `المغادرة المجدولة: ${date(data.flight.scheduledDepartureAt)}`,
        `نافذة تسجيل الدخول: ${date(data.flight.checkInStartsAt)} - ${date(data.flight.checkInEndsAt)}`, `الكاونترات: ${counters}`,
        `حالة PreCheck: ${data.preCheck?.status ?? '-'}`, `حالة OutCheck: ${data.outCheck?.status ?? '-'}`,
        `المحاولة الأخيرة: ${attempt?.attemptNumber ?? '-'} / ${attempt?.review?.decision ?? '-'}`,
        `المراجع: ${attempt?.review?.reviewedBy ?? '-'}`, `الحالة النهائية: ${data.lifecycle.finalStatus}`,
        `وقت الإغلاق: ${date(data.lifecycle.closedAt)}`, `المرفقات: ${formats}`, 'هذه رسالة منشأة تلقائياً من النظام.'].join('\n'),
    };
    return { subject: `Final operational report — flight ${data.flight.flightNumber}`,
      body: [`Airline: ${data.company.name} (${data.company.code})`, `Flight: ${data.flight.flightNumber}`,
        `Route: ${data.flight.origin} - ${data.flight.destination}`, `Aircraft: ${data.flight.aircraftType ?? '-'}`,
        `Scheduled departure: ${date(data.flight.scheduledDepartureAt)}`,
        `Check-in window: ${date(data.flight.checkInStartsAt)} - ${date(data.flight.checkInEndsAt)}`, `Counters: ${counters}`,
        `PreCheck status: ${data.preCheck?.status ?? '-'}`, `OutCheck status: ${data.outCheck?.status ?? '-'}`,
        `Latest attempt: ${attempt?.attemptNumber ?? '-'} / ${attempt?.review?.decision ?? '-'}`,
        `Reviewer: ${attempt?.review?.reviewedBy ?? '-'}`, `Final status: ${data.lifecycle.finalStatus}`,
        `Closed at: ${date(data.lifecycle.closedAt)}`, `Attachments: ${formats}`, 'This is an automatically generated system message.'].join('\n') };
  }

  private async fail(job: OperationalReportEmailJob, error: unknown) {
    const lastError = this.sanitize(error); const exhausted = job.attempts >= job.maxAttempts;
    const nextAttemptAt = new Date(Date.now() + this.policy.retryBaseMs() * 2 ** Math.max(0, job.attempts - 1));
    await this.prisma.operationalReportEmailJob.updateMany({ where: { id: job.id, lockedBy: this.workerId }, data: {
      status: OperationalReportEmailJobStatus.FAILED, lastError, nextAttemptAt, lockedAt: null, lockedBy: null } });
    await this.audit.record({ action: exhausted ? 'EXHAUST_OPERATIONAL_REPORT_EMAIL_JOB' : 'FAIL_OPERATIONAL_REPORT_EMAIL_JOB',
      entityType: 'OperationalReportEmailJob', entityId: job.id, result: 'FAILED', note: lastError,
      metadata: { ...this.metadata(job), nextAttemptAt: exhausted ? null : nextAttemptAt.toISOString() } });
    this.realtime?.emitScoped(REALTIME_EVENTS.REPORT_EMAIL_JOB_STATUS, { resourceId: job.id, status: 'FAILED',
      companyId: job.companyId, dailySessionFlightId: job.dailySessionFlightId, updatedAt: new Date().toISOString() }, { admins: true });
    if (exhausted && this.notifications) await this.notifications.create({ title: 'Operational report email delivery failed',
      message: 'A report email job exhausted its retry attempts and requires administrator action.',
      type: NotificationType.REPORT_EMAIL_FAILED, targetRole: 'ADMIN', entityType: 'OperationalReportEmailJob', entityId: job.id });
  }
  private metadata(job: OperationalReportEmailJob) { return { flightId: job.dailySessionFlightId,
    generationType: job.generationType, deliveryNumber: job.deliveryNumber, attempts: job.attempts, maxAttempts: job.maxAttempts }; }
  private sanitize(error: unknown) { return (error instanceof Error ? error.message : 'Email delivery failed')
    .replace(/[A-Za-z]:\\[^\s]+/g, '[path]').replace(/[\r\n]+/g, ' ').slice(0, 500); }
}
