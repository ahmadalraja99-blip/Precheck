import { ConflictException, ForbiddenException, Injectable, NotFoundException, Optional } from '@nestjs/common';
import { CounterStatus, DailyDutyStatus, HandoverStatus, IssueStatus, PermissionCode, Role } from '@prisma/client';
import { AuditService } from '../../audit/audit.service';
import { AuthUser } from '../../common/types/auth-user.type';
import { PrismaService } from '../../prisma/prisma.service';
import { ResolveDailyFlightOperationalIssueDto } from './dto/resolve-daily-flight-operational-issue.dto';
import { NotificationsGateway, REALTIME_EVENTS } from '../../notifications/notifications.gateway';

@Injectable()
export class DailyFlightOperationalIssuesService {
  constructor(private readonly prisma: PrismaService, private readonly audit: AuditService,
    @Optional() private readonly realtime?: NotificationsGateway) {}
  async listForFlight(flightId: string, user: AuthUser) {
    const flight = await this.prisma.dailySessionFlight.findUnique({ where: { id: flightId }, select: { companyId: true,
      isCarryOver: true, handoverStatus: true, carriedToDailyDutyId: true,
      dailyCompanySession: { select: { dailyDuty: { select: { movementSupervisorId: true } } } } } });
    if (!flight) throw new NotFoundException('Session flight not found');
    if (user.role === Role.COMPANY_USER && user.companyId !== flight.companyId) throw new ForbiddenException('Resource belongs to another company');
    if (user.role === Role.MOVEMENT_SUPERVISOR && flight.dailyCompanySession.dailyDuty.movementSupervisorId !== user.id) {
      const acceptedCarryOver = flight.isCarryOver &&
        (flight.handoverStatus === HandoverStatus.ACCEPTED || flight.handoverStatus === HandoverStatus.COMPLETED) &&
        flight.carriedToDailyDutyId && await this.prisma.dailyDuty.findFirst({ where: { id: flight.carriedToDailyDutyId,
          movementSupervisorId: user.id, status: DailyDutyStatus.OPEN, expiresAt: { gt: new Date() } }, select: { id: true } });
      if (!acceptedCarryOver) throw new ForbiddenException('Flight is outside the authorized duty');
    }
    return this.prisma.dailyFlightOperationalIssue.findMany({ where: { dailySessionFlightId: flightId },
      include: { counter: { select: { id: true, code: true, name: true, status: true } },
        reportedBy: { select: { id: true, fullName: true } }, resolvedBy: { select: { id: true, fullName: true } } },
      orderBy: [{ attemptNumber: 'asc' }, { reportedAt: 'asc' }] });
  }
  async resolve(id: string, dto: ResolveDailyFlightOperationalIssueDto, user: AuthUser) {
    if (user.role !== Role.SUPER_ADMIN && (user.role !== Role.ADMIN || !user.permissions.includes(PermissionCode.CAN_RESOLVE_ISSUES)))
      throw new ForbiddenException('CAN_RESOLVE_ISSUES permission is required');
    const resolved = await this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT "id" FROM "DailyFlightOperationalIssue" WHERE "id"=${id} FOR UPDATE`;
      const issue = await tx.dailyFlightOperationalIssue.findUnique({ where: { id } });
      if (!issue) throw new NotFoundException('Operational issue not found');
      if (issue.status !== IssueStatus.OPEN && issue.status !== IssueStatus.IN_PROGRESS) throw new ConflictException('Operational issue is already resolved');
      await tx.$queryRaw`SELECT "id" FROM "Counter" WHERE "id"=${issue.counterId} FOR UPDATE`;
      const updated = await tx.dailyFlightOperationalIssue.update({ where: { id }, data: { status: IssueStatus.RESOLVED,
        resolutionNote: dto.resolutionNote.trim(), verificationNote: dto.verificationNote?.trim() || null,
        resolvedById: user.id, resolvedAt: new Date() } });
      const remaining = await tx.dailyFlightOperationalIssue.count({ where: { counterId: issue.counterId,
        status: { in: [IssueStatus.OPEN, IssueStatus.IN_PROGRESS] } } });
      if (!remaining) await tx.counter.updateMany({ where: { id: issue.counterId, status: CounterStatus.UNAVAILABLE },
        data: { status: CounterStatus.AVAILABLE, notes: `Operational issue ${id} resolved` } });
      await this.audit.record({ user, permissionUsed: PermissionCode.CAN_RESOLVE_ISSUES,
        action: 'RESOLVE_DAILY_FLIGHT_OPERATIONAL_ISSUE', entityType: 'DailyFlightOperationalIssue', entityId: id,
        metadata: { flightId: issue.dailySessionFlightId, counterId: issue.counterId, previousStatus: issue.status,
          nextStatus: IssueStatus.RESOLVED } }, tx);
      return updated;
    });
    const flight = this.realtime ? await this.prisma.dailySessionFlight.findUnique({ where: { id: resolved.dailySessionFlightId },
      select: { companyId: true, movementCategoryId: true, dailyCompanySessionId: true,
        dailyCompanySession: { select: { dailyDutyId: true } } } }) : null;
    if (flight) this.realtime!.emitScoped(REALTIME_EVENTS.ISSUE_RESOLVED,
      { resourceId: resolved.id, dailySessionFlightId: resolved.dailySessionFlightId,
        dailyCompanySessionId: flight.dailyCompanySessionId, dailyDutyId: flight.dailyCompanySession.dailyDutyId,
        companyId: flight.companyId, movementCategoryId: flight.movementCategoryId,
        status: resolved.status, updatedAt: resolved.updatedAt.toISOString() },
      { companyId: flight.companyId, dailyDutyId: flight.dailyCompanySession.dailyDutyId,
        movementCategoryId: flight.movementCategoryId, admins: true });
    return resolved;
  }
}
