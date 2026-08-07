import { Injectable, NotFoundException } from '@nestjs/common';
import { NotificationType, Prisma, Role } from '@prisma/client';
import { PaginationDto, paginate } from '../common/dto/pagination.dto';
import { AuthUser } from '../common/types/auth-user.type';
import { PrismaService } from '../prisma/prisma.service';
import { NotificationsGateway } from './notifications.gateway';
import { REALTIME_EVENTS, RealtimeEventName } from './notifications.gateway';

@Injectable()
export class NotificationsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly gateway: NotificationsGateway,
  ) {}

  async create(input: {
    title: string;
    message: string;
    type: NotificationType;
    targetRole?: Role;
    targetUserId?: string;
    targetCompanyId?: string;
    entityType?: string;
    entityId?: string;
  }) {
    const notification = await this.prisma.notification.create({ data: input });
    this.gateway.emitNotification(notification);
    const operationalEvent = this.operationalEvent(input.type);
    if (operationalEvent) this.gateway.emitScoped(operationalEvent, { resourceId: input.entityId ?? notification.id,
      parentId: input.entityId, companyId: input.targetCompanyId, updatedAt: notification.createdAt.toISOString(),
      status: input.type }, { userId: input.targetUserId, companyId: input.targetCompanyId, role: input.targetRole,
      authenticated: !input.targetUserId && !input.targetCompanyId && !input.targetRole });
    return notification;
  }

  async listForUser(user: AuthUser, query: PaginationDto) {
    const { skip, take, page, limit } = paginate(query);
    const scope: Prisma.NotificationWhereInput[] = [
        { targetUserId: user.id },
        { targetRole: user.role },
        { targetUserId: null, targetRole: null, targetCompanyId: null },
      ];
    if (user.companyId) scope.push({ targetCompanyId: user.companyId });
    const where: Prisma.NotificationWhereInput = { OR: scope };
    const [items, total, unread] = await this.prisma.$transaction([
      this.prisma.notification.findMany({ where, skip, take, orderBy: { createdAt: 'desc' } }),
      this.prisma.notification.count({ where }),
      this.prisma.notification.count({ where: { AND: [where, { readAt: null }] } }),
    ]);
    return { items, meta: { total, unread, page, limit } };
  }

  async markRead(id: string, user: AuthUser) {
    const allowed = await this.prisma.notification.findFirst({ where: { id, OR: this.scope(user) } });
    if (!allowed) throw new NotFoundException('Notification not found');
    const notification = await this.prisma.notification.update({ where: { id }, data: { readAt: new Date() } });
    this.gateway.emitScoped('notification.read', { resourceId: id, status: 'READ', updatedAt: notification.readAt!.toISOString() },
      { userId: user.id });
    return notification;
  }

  async markAllRead(user: AuthUser) {
    const result = await this.prisma.notification.updateMany({
      where: { OR: this.scope(user) },
      data: { readAt: new Date() },
    });
    this.gateway.emitScoped('notification.read-all', { resourceId: user.id, status: 'READ', updatedAt: new Date().toISOString() },
      { userId: user.id });
    return result;
  }

  private scope(user: AuthUser): Prisma.NotificationWhereInput[] {
    const scope: Prisma.NotificationWhereInput[] = [{ targetUserId: user.id }, { targetRole: user.role },
      { targetUserId: null, targetRole: null, targetCompanyId: null }];
    if (user.companyId) scope.push({ targetCompanyId: user.companyId });
    return scope;
  }

  private operationalEvent(type: NotificationType): RealtimeEventName | undefined {
    const events: Partial<Record<NotificationType, RealtimeEventName>> = {
      PRECHECK_STARTED: REALTIME_EVENTS.PRECHECK_STARTED, PRECHECK_COMPLETED: REALTIME_EVENTS.PRECHECK_SUBMITTED,
      PRECHECK_ISSUE_CREATED: REALTIME_EVENTS.ISSUE_CREATED, OPERATIONAL_ISSUE_CREATED: REALTIME_EVENTS.ISSUE_CREATED,
      ISSUE_RESOLVED: REALTIME_EVENTS.ISSUE_RESOLVED, OUTCHECK_SUBMITTED: REALTIME_EVENTS.OUTCHECK_SUBMITTED,
      OUTCHECK_APPROVED: REALTIME_EVENTS.OUTCHECK_APPROVED, OUTCHECK_REJECTED: REALTIME_EVENTS.OUTCHECK_REJECTED,
      REPORT_GENERATED: REALTIME_EVENTS.REPORT_GENERATED, REPORT_FAILED: REALTIME_EVENTS.REPORT_FAILED,
      REPORT_EMAIL_FAILED: REALTIME_EVENTS.REPORT_EMAIL_JOB_STATUS, EMAIL_FAILED: REALTIME_EVENTS.REPORT_EMAIL_JOB_STATUS,
      CARRY_OVER_AVAILABLE: REALTIME_EVENTS.FLIGHT_CARRY_OVER_CREATED,
    };
    return events[type];
  }
}
