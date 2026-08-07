import { Injectable, Logger, Optional } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Interval } from '@nestjs/schedule';
import {
  OperationalReportJob,
  OperationalReportJobStatus,
  OperationalReportStatus,
  PermissionCode,
  NotificationType,
  Prisma,
} from '@prisma/client';
import { randomUUID } from 'crypto';
import { AuditService } from '../audit/audit.service';
import { PrismaService } from '../prisma/prisma.service';
import { OperationalReportsService } from './operational-reports.service';
import { NotificationsGateway, REALTIME_EVENTS } from '../notifications/notifications.gateway';
import { NotificationsService } from '../notifications/notifications.service';

@Injectable()
export class OperationalReportJobsProcessor {
  private readonly logger = new Logger(OperationalReportJobsProcessor.name);
  private readonly workerId = `${process.pid}-${randomUUID()}`;

  constructor(
    private readonly prisma: PrismaService,
    private readonly reports: OperationalReportsService,
    private readonly audit: AuditService,
    private readonly config: ConfigService,
    @Optional() private readonly realtime?: NotificationsGateway,
    @Optional() private readonly notifications?: NotificationsService,
  ) {}

  @Interval(Number(process.env.OPERATIONAL_REPORT_JOB_INTERVAL_MS ?? 30000))
  async tick() {
    if (!this.enabled()) return;
    try {
      await this.recoverStaleJobs();
      const jobs = await this.claimBatch();
      for (const job of jobs) await this.process(job);
    } catch (error) {
      this.logger.error(error instanceof Error ? error.message : 'Operational report job tick failed');
    }
  }

  async claimBatch() {
    const batchSize = this.positiveInt('OPERATIONAL_REPORT_JOB_BATCH_SIZE', 10);
    return this.prisma.$queryRaw<OperationalReportJob[]>(Prisma.sql`
      WITH candidates AS (
        SELECT "id"
        FROM "OperationalReportJob"
        WHERE "nextAttemptAt" <= NOW()
          AND "attempts" < "maxAttempts"
          AND "status" IN ('PENDING'::"OperationalReportJobStatus", 'FAILED'::"OperationalReportJobStatus")
          AND "lockedAt" IS NULL
        ORDER BY "nextAttemptAt" ASC, "createdAt" ASC
        FOR UPDATE SKIP LOCKED
        LIMIT ${batchSize}
      )
      UPDATE "OperationalReportJob" AS job
      SET "status" = 'PROCESSING'::"OperationalReportJobStatus",
          "lockedAt" = NOW(),
          "lockedBy" = ${this.workerId},
          "attempts" = job."attempts" + 1,
          "updatedAt" = NOW()
      FROM candidates
      WHERE job."id" = candidates."id"
      RETURNING job.*
    `);
  }

  async recoverStaleJobs(now = new Date()) {
    const cutoff = new Date(now.getTime() - this.positiveInt('OPERATIONAL_REPORT_JOB_STALE_LOCK_MS', 600000));
    const stale = await this.prisma.operationalReportJob.findMany({
      where: { status: OperationalReportJobStatus.PROCESSING, lockedAt: { lt: cutoff } },
    });
    for (const job of stale) {
      const recovered = await this.prisma.operationalReportJob.updateMany({
        where: { id: job.id, status: OperationalReportJobStatus.PROCESSING, lockedAt: job.lockedAt },
        data: { status: OperationalReportJobStatus.PENDING, lockedAt: null, lockedBy: null, nextAttemptAt: now },
      });
      if (recovered.count === 1) await this.audit.record({
        action: 'RECOVER_STALE_OPERATIONAL_REPORT_JOB', entityType: 'OperationalReportJob', entityId: job.id,
        metadata: this.auditMetadata(job),
      });
    }
    return stale.length;
  }

  async process(job: OperationalReportJob) {
    await this.audit.record({
      action: 'START_OPERATIONAL_REPORT_JOB', entityType: 'OperationalReportJob', entityId: job.id,
      metadata: this.auditMetadata(job),
    });
    try {
      const flight = await this.prisma.dailySessionFlight.findUnique({
        where: { id: job.dailySessionFlightId },
        include: { createdBy: true },
      });
      if (!flight) throw new Error('Session flight no longer exists');
      const report = await this.reports.generateAutomaticFlight(job.dailySessionFlightId, job.format, {
        id: flight.createdBy.id,
        email: flight.createdBy.email,
        fullName: flight.createdBy.fullName,
        role: flight.createdBy.role,
        companyId: flight.createdBy.companyId,
        permissions: [PermissionCode.CAN_EXPORT_REPORTS],
      });
      if (report.status !== OperationalReportStatus.GENERATED) {
        throw new Error(report.errorMessage ?? 'Automatic report generation failed');
      }
      const completedAt = new Date();
      const completed = await this.prisma.operationalReportJob.updateMany({
        where: { id: job.id, status: OperationalReportJobStatus.PROCESSING, lockedBy: this.workerId },
        data: { status: OperationalReportJobStatus.COMPLETED, completedAt, lockedAt: null, lockedBy: null, lastError: null },
      });
      if (completed.count !== 1) throw new Error('Operational report job lock was lost');
      await this.audit.record({
        action: 'COMPLETE_OPERATIONAL_REPORT_JOB', entityType: 'OperationalReportJob', entityId: job.id,
        metadata: { ...this.auditMetadata(job), reportId: report.id },
      });
      this.realtime?.emitScoped(REALTIME_EVENTS.REPORT_JOB_STATUS, { resourceId: job.id, status: 'COMPLETED',
        dailySessionFlightId: job.dailySessionFlightId, updatedAt: completedAt.toISOString() }, { admins: true });
      this.realtime?.emitScoped(REALTIME_EVENTS.REPORT_GENERATED, { resourceId: report.id, status: report.status,
        dailySessionFlightId: job.dailySessionFlightId, updatedAt: completedAt.toISOString() }, { admins: true });
    } catch (error) {
      await this.fail(job, error);
    }
  }

  private async fail(job: OperationalReportJob, error: unknown) {
    const lastError = this.sanitize(error);
    const exhausted = job.attempts >= job.maxAttempts;
    const retryDelay = this.positiveInt('OPERATIONAL_REPORT_JOB_RETRY_BASE_MS', 60000) * 2 ** Math.max(0, job.attempts - 1);
    const nextAttemptAt = new Date(Date.now() + retryDelay);
    await this.prisma.operationalReportJob.updateMany({
      where: { id: job.id, status: OperationalReportJobStatus.PROCESSING, lockedBy: this.workerId },
      data: {
        status: OperationalReportJobStatus.FAILED,
        lastError,
        nextAttemptAt,
        lockedAt: null,
        lockedBy: null,
      },
    });
    await this.audit.record({
      action: 'FAIL_OPERATIONAL_REPORT_JOB', entityType: 'OperationalReportJob', entityId: job.id,
      result: 'FAILED', note: lastError, metadata: this.auditMetadata(job),
    });
    this.realtime?.emitScoped(REALTIME_EVENTS.REPORT_JOB_STATUS, { resourceId: job.id, status: 'FAILED',
      dailySessionFlightId: job.dailySessionFlightId, updatedAt: new Date().toISOString() }, { admins: true });
    this.realtime?.emitScoped(REALTIME_EVENTS.REPORT_FAILED, { resourceId: job.id, status: 'FAILED',
      dailySessionFlightId: job.dailySessionFlightId, updatedAt: new Date().toISOString() }, { admins: true });
    if (exhausted && this.notifications) await this.notifications.create({ title: 'Operational report generation failed',
      message: 'A report job exhausted its retry attempts and requires administrator action.', type: NotificationType.REPORT_FAILED,
      targetRole: 'ADMIN', entityType: 'OperationalReportJob', entityId: job.id });
    await this.audit.record({
      action: exhausted ? 'EXHAUST_OPERATIONAL_REPORT_JOB' : 'SCHEDULE_OPERATIONAL_REPORT_JOB_RETRY',
      entityType: 'OperationalReportJob', entityId: job.id,
      result: exhausted ? 'FAILED' : 'SUCCESS',
      note: lastError,
      metadata: { ...this.auditMetadata(job), nextAttemptAt: exhausted ? null : nextAttemptAt.toISOString() },
    });
  }

  private auditMetadata(job: OperationalReportJob) {
    return {
      jobId: job.id, flightId: job.dailySessionFlightId, format: job.format,
      generationType: job.generationType, attemptCount: job.attempts, maxAttempts: job.maxAttempts,
    };
  }

  private sanitize(error: unknown) {
    return (error instanceof Error ? error.message : 'Operational report job failed')
      .replace(/[A-Za-z]:\\[^\s]+/g, '[path]')
      .replace(/[\r\n]+/g, ' ')
      .slice(0, 500);
  }

  private enabled() {
    return !['false', '0', 'no'].includes(String(this.config.get('OPERATIONAL_REPORT_JOB_ENABLED', 'true')).toLowerCase());
  }

  private positiveInt(key: string, fallback: number) {
    const value = Number(this.config.get(key, fallback));
    return Number.isInteger(value) && value > 0 ? value : fallback;
  }
}
