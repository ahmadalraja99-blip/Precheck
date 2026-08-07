import { ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import {
  OperationalReportEmailJobStatus, OperationalReportEmailPurpose, OperationalReportGenerationType,
  OperationalReportStatus, PermissionCode, Prisma, Role,
} from '@prisma/client';
import { AuditService } from '../audit/audit.service';
import { paginate } from '../common/dto/pagination.dto';
import { AuthUser } from '../common/types/auth-user.type';
import { PrismaService } from '../prisma/prisma.service';
import { OperationalReportEmailJobQueryDto } from './dto/operational-report-email-job-query.dto';
import { SendOperationalReportEmailDto } from './dto/send-operational-report-email.dto';
import { OPERATIONAL_REPORT_TEMPLATE_VERSION } from './operational-report.constants';
import { OperationalReportEmailPolicyService } from './operational-report-email-policy.service';

@Injectable()
export class OperationalReportEmailJobsService {
  constructor(private readonly prisma: PrismaService, private readonly audit: AuditService,
    private readonly policy: OperationalReportEmailPolicyService) {}

  async enqueueIfReady(flightId: string, generationType: OperationalReportGenerationType,
    templateVersion = OPERATIONAL_REPORT_TEMPLATE_VERSION, manual = false, user?: AuthUser) {
    if (!this.policy.enabled()) {
      if (manual) throw new ConflictException('Operational report email delivery is disabled');
      return null;
    }
    if (!manual && !this.policy.autoSend()) return null;
    const formats = this.policy.requiredFormats();
    if (!formats.length) {
      if (manual) throw new ConflictException('No operational report email attachments are enabled');
      return null;
    }
    const flight = await this.prisma.dailySessionFlight.findUnique({ where: { id: flightId }, select: { companyId: true } });
    if (!flight) throw new NotFoundException('Session flight not found');
    const reports = await this.prisma.flightReport.findMany({ where: {
      dailySessionFlightId: flightId, generationType, templateVersion, format: { in: formats },
      status: OperationalReportStatus.GENERATED,
    }, select: { format: true } });
    if (!formats.every((format) => reports.some((report) => report.format === format))) {
      if (manual) throw new ConflictException('All configured report attachments must be generated first');
      return null;
    }
    const key = { dailySessionFlightId: flightId, generationType,
      emailPurpose: OperationalReportEmailPurpose.FINAL_FLIGHT_REPORT, templateVersion, deliveryNumber: 1 };
    const job = await this.prisma.operationalReportEmailJob.upsert({
      where: { dailySessionFlightId_generationType_emailPurpose_templateVersion_deliveryNumber: key },
      create: { ...key, companyId: flight.companyId, maxAttempts: this.policy.maxAttempts() }, update: {},
    });
    await this.audit.record({ user, permissionUsed: user ? PermissionCode.CAN_SEND_REPORT_EMAILS : undefined,
      action: manual ? 'REQUEST_OPERATIONAL_REPORT_EMAIL' : 'ENQUEUE_OPERATIONAL_REPORT_EMAIL_JOB',
      entityType: 'OperationalReportEmailJob', entityId: job.id,
      metadata: { flightId, generationType, templateVersion, deliveryNumber: job.deliveryNumber } });
    return job;
  }

  async send(flightId: string, dto: SendOperationalReportEmailDto, user: AuthUser) {
    this.assertManagePermission(user);
    const generationType = dto.generationType ?? await this.latestReadyGenerationType(flightId);
    const job = await this.enqueueIfReady(flightId, generationType,
      dto.templateVersion ?? OPERATIONAL_REPORT_TEMPLATE_VERSION, true, user);
    if (job?.status === OperationalReportEmailJobStatus.COMPLETED) {
      throw new ConflictException('Report email already completed; use resend to create a new delivery');
    }
    return job;
  }

  async list(query: OperationalReportEmailJobQueryDto) {
    const { skip, take, page, limit } = paginate(query);
    const where: Prisma.OperationalReportEmailJobWhereInput = {
      status: query.status, companyId: query.companyId, dailySessionFlightId: query.flightId,
      generationType: query.generationType,
      createdAt: query.createdFrom || query.createdTo ? {
        gte: query.createdFrom ? new Date(query.createdFrom) : undefined,
        lte: query.createdTo ? new Date(query.createdTo) : undefined,
      } : undefined,
      recipientMetadata: query.recipientEmail ? { path: ['all'], string_contains: query.recipientEmail.toLowerCase() } : undefined,
    };
    const [items, total] = await this.prisma.$transaction([
      this.prisma.operationalReportEmailJob.findMany({ where, skip, take, orderBy: { createdAt: 'desc' },
        include: { company: { select: { id: true, code: true, name: true } },
          dailySessionFlight: { select: { id: true, flight: { select: { flightNumber: true } } } } } }),
      this.prisma.operationalReportEmailJob.count({ where }),
    ]);
    return { items, meta: { total, page, limit } };
  }

  async find(id: string) {
    const job = await this.prisma.operationalReportEmailJob.findUnique({ where: { id },
      include: { company: { select: { id: true, code: true, name: true } },
        dailySessionFlight: { select: { id: true, flight: true } } } });
    if (!job) throw new NotFoundException('Operational report email job not found');
    return job;
  }

  async retry(id: string, user: AuthUser) {
    this.assertManagePermission(user);
    const job = await this.find(id);
    if (job.status !== OperationalReportEmailJobStatus.FAILED) throw new ConflictException('Only failed email jobs can be retried');
    const updated = await this.prisma.operationalReportEmailJob.update({ where: { id }, data: {
      status: OperationalReportEmailJobStatus.PENDING, nextAttemptAt: new Date(), lockedAt: null, lockedBy: null,
      maxAttempts: Math.max(job.maxAttempts, job.attempts + this.policy.maxAttempts()), lastError: null,
    } });
    await this.audit.record({ user, permissionUsed: PermissionCode.CAN_SEND_REPORT_EMAILS,
      action: 'RETRY_OPERATIONAL_REPORT_EMAIL_JOB', entityType: 'OperationalReportEmailJob', entityId: id });
    return updated;
  }

  async resend(id: string, user: AuthUser) {
    this.assertManagePermission(user);
    const source = await this.find(id);
    if (source.status !== OperationalReportEmailJobStatus.COMPLETED) throw new ConflictException('Only completed email jobs can be resent');
    const latest = await this.prisma.operationalReportEmailJob.aggregate({ where: {
      dailySessionFlightId: source.dailySessionFlightId, generationType: source.generationType,
      emailPurpose: source.emailPurpose, templateVersion: source.templateVersion,
    }, _max: { deliveryNumber: true } });
    try {
      const job = await this.prisma.operationalReportEmailJob.create({ data: {
        dailySessionFlightId: source.dailySessionFlightId, companyId: source.companyId,
        generationType: source.generationType, emailPurpose: source.emailPurpose,
        templateVersion: source.templateVersion, deliveryNumber: (latest._max.deliveryNumber ?? 0) + 1,
        maxAttempts: this.policy.maxAttempts(),
      } });
      await this.audit.record({ user, permissionUsed: PermissionCode.CAN_SEND_REPORT_EMAILS,
        action: 'RESEND_OPERATIONAL_REPORT_EMAIL', entityType: 'OperationalReportEmailJob', entityId: job.id,
        metadata: { sourceJobId: id, deliveryNumber: job.deliveryNumber } });
      return job;
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002')
        throw new ConflictException('A resend was created concurrently; refresh and try again');
      throw error;
    }
  }

  private async latestReadyGenerationType(flightId: string) {
    const report = await this.prisma.flightReport.findFirst({ where: { dailySessionFlightId: flightId,
      status: OperationalReportStatus.GENERATED }, orderBy: { generatedAt: 'desc' }, select: { generationType: true } });
    if (!report) throw new ConflictException('No generated operational reports are available');
    return report.generationType;
  }

  private assertManagePermission(user: AuthUser) {
    if (user.role !== Role.SUPER_ADMIN &&
      (user.role !== Role.ADMIN || !user.permissions.includes(PermissionCode.CAN_SEND_REPORT_EMAILS)))
      throw new ForbiddenException('CAN_SEND_REPORT_EMAILS permission is required');
  }
}
