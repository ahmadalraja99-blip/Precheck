import { ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { OperationalReportJobStatus, PermissionCode, Prisma, Role } from '@prisma/client';
import { AuditService } from '../audit/audit.service';
import { paginate } from '../common/dto/pagination.dto';
import { AuthUser } from '../common/types/auth-user.type';
import { PrismaService } from '../prisma/prisma.service';
import { OperationalReportJobQueryDto } from './dto/operational-report-job-query.dto';

@Injectable()
export class OperationalReportJobsService {
  constructor(private readonly prisma: PrismaService, private readonly audit: AuditService) {}

  async list(query: OperationalReportJobQueryDto) {
    const { skip, take, page, limit } = paginate(query);
    const where: Prisma.OperationalReportJobWhereInput = {
      status: query.status, format: query.format, dailySessionFlightId: query.flightId,
      generationType: query.generationType,
      createdAt: query.createdFrom || query.createdTo ? {
        gte: query.createdFrom ? new Date(query.createdFrom) : undefined,
        lte: query.createdTo ? new Date(query.createdTo) : undefined,
      } : undefined,
    };
    const [items, total] = await this.prisma.$transaction([
      this.prisma.operationalReportJob.findMany({
        where, skip, take, orderBy: { createdAt: 'desc' },
        include: { dailySessionFlight: { include: { flight: true, company: true } } },
      }),
      this.prisma.operationalReportJob.count({ where }),
    ]);
    return { items: items.map(({ lockedBy: _lockedBy, lockedAt: _lockedAt, ...item }) => item), meta: { total, page, limit } };
  }

  async find(id: string) {
    const job = await this.prisma.operationalReportJob.findUnique({
      where: { id }, include: { dailySessionFlight: { include: { flight: true, company: true } } },
    });
    if (!job) throw new NotFoundException('Operational report job not found');
    const { lockedBy: _lockedBy, lockedAt: _lockedAt, ...publicJob } = job;
    return publicJob;
  }

  async retry(id: string, user: AuthUser) {
    if (user.role !== Role.SUPER_ADMIN &&
      (user.role !== Role.ADMIN || !user.permissions.includes(PermissionCode.CAN_EXPORT_REPORTS)))
      throw new ForbiddenException('CAN_EXPORT_REPORTS permission is required');
    const job = await this.prisma.operationalReportJob.findUnique({ where: { id } });
    if (!job) throw new NotFoundException('Operational report job not found');
    if (job.status !== OperationalReportJobStatus.FAILED) throw new ConflictException('Only failed jobs can be retried');
    const updated = await this.prisma.operationalReportJob.updateMany({
      where: { id, status: OperationalReportJobStatus.FAILED },
      data: {
        status: OperationalReportJobStatus.PENDING,
        nextAttemptAt: new Date(),
        maxAttempts: Math.max(job.maxAttempts, job.attempts + 1),
        lockedAt: null,
        lockedBy: null,
      },
    });
    if (updated.count !== 1) throw new ConflictException('Operational report job changed concurrently');
    await this.audit.record({
      user, permissionUsed: PermissionCode.CAN_EXPORT_REPORTS,
      action: 'MANUALLY_RETRY_OPERATIONAL_REPORT_JOB', entityType: 'OperationalReportJob', entityId: id,
      metadata: { jobId: id, flightId: job.dailySessionFlightId, format: job.format, attempts: job.attempts },
    });
    return this.find(id);
  }
}
