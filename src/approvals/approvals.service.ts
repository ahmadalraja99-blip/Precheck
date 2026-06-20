import { BadRequestException, Injectable } from '@nestjs/common';
import { ApprovalDecision, CounterStatus, IssueSeverity, IssueType, NotificationType, Role, SessionStatus } from '@prisma/client';
import { AuditService } from '../audit/audit.service';
import { AuthUser } from '../common/types/auth-user.type';
import { CounterStatusService } from '../counters/counter-status.service';
import { NotificationsService } from '../notifications/notifications.service';
import { PrismaService } from '../prisma/prisma.service';
import { ReportsService } from '../reports/reports.service';
import { SessionsService } from '../sessions/sessions.service';

@Injectable()
export class ApprovalsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly sessions: SessionsService,
    private readonly counterStatus: CounterStatusService,
    private readonly reports: ReportsService,
    private readonly audit: AuditService,
    private readonly notifications: NotificationsService,
  ) {}

  async approve(sessionId: string, user: AuthUser) {
    const session = await this.sessions.find(sessionId, user);
    if (session.status !== SessionStatus.OUTCHECK_PENDING_APPROVAL) throw new BadRequestException('OutCheck is not pending approval');
    const counterIds = session.counters.map((row) => row.counterId);
    const approval = await this.prisma.$transaction(async (tx) => {
      const created = await tx.approval.create({ data: { sessionId, approvedById: user.id, decision: ApprovalDecision.APPROVED } });
      await tx.session.update({ where: { id: sessionId }, data: { status: SessionStatus.CLOSED, actualClosedAt: new Date() } });
      await this.counterStatus.transitionMany(counterIds, CounterStatus.AVAILABLE, user, 'OutCheck approved', tx);
      return created;
    });
    await this.audit.record({ user, permissionUsed: 'CAN_APPROVE_OUTCHECK', action: 'APPROVE_OUTCHECK', entityType: 'Session', entityId: sessionId });
    await this.notifications.create({ title: 'OutCheck approved', message: 'Session closed successfully', type: NotificationType.OUTCHECK_APPROVED, targetCompanyId: session.companyId, entityType: 'Session', entityId: sessionId });
    const report = await this.reports.generateSessionFinalReport(sessionId, user.id);
    await this.reports.emailFinalReportToAdmins(report.id);
    return { approval, report };
  }

  async reject(sessionId: string, rejectionReason: string, user: AuthUser) {
    const session = await this.sessions.find(sessionId, user);
    if (session.status !== SessionStatus.OUTCHECK_PENDING_APPROVAL) throw new BadRequestException('OutCheck is not pending approval');
    const counterIds = session.counters.map((row) => row.counterId);
    const approval = await this.prisma.$transaction(async (tx) => {
      const created = await tx.approval.create({ data: { sessionId, approvedById: user.id, decision: ApprovalDecision.REJECTED, rejectionReason } });
      await tx.session.update({ where: { id: sessionId }, data: { status: SessionStatus.OUTCHECK_REJECTED } });
      for (const counterId of counterIds) {
        await tx.issue.create({
          data: {
            sessionId,
            counterId,
            type: IssueType.OUTCHECK,
            severity: IssueSeverity.HIGH,
            title: 'OutCheck rejected',
            description: rejectionReason,
            createdById: user.id,
          },
        });
      }
      await this.counterStatus.transitionMany(counterIds, CounterStatus.UNAVAILABLE, user, 'OutCheck rejected', tx);
      return created;
    });
    await this.audit.record({ user, permissionUsed: 'CAN_APPROVE_OUTCHECK', action: 'REJECT_OUTCHECK', entityType: 'Session', entityId: sessionId, note: rejectionReason });
    await this.notifications.create({ title: 'OutCheck rejected', message: rejectionReason, type: NotificationType.OUTCHECK_REJECTED, targetCompanyId: session.companyId, entityType: 'Session', entityId: sessionId });
    return approval;
  }
}
