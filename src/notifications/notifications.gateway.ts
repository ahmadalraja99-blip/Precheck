import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { PermissionCode, Role } from '@prisma/client';
import { OnGatewayConnection, OnGatewayDisconnect, WebSocketGateway, WebSocketServer } from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import { PrismaService } from '../prisma/prisma.service';
import { RolesPermissionsService } from '../roles-permissions/roles-permissions.service';

export const REALTIME_EVENTS = {
  DUTY_ACTIVATED: 'duty.activated', DUTY_RESUMED: 'duty.resumed', DUTY_EXPIRED: 'duty.expired', DUTY_CLOSED: 'duty.closed',
  COMPANY_SESSION_CREATED: 'company-session.created', COMPANY_SESSION_UPDATED: 'company-session.updated',
  COMPANY_SESSION_CLOSED: 'company-session.closed', COMPANY_SESSION_CARRY_OVER: 'company-session.carry-over',
  FLIGHT_CREATED: 'flight.created', FLIGHT_UPDATED: 'flight.updated', FLIGHT_STATUS_CHANGED: 'flight.status-changed',
  FLIGHT_CLOSED: 'flight.closed', FLIGHT_CARRY_OVER_CREATED: 'flight.carry-over-created', HANDOVER_ACCEPTED: 'flight.handover-accepted',
  RESERVATION_CREATED: 'counter-reservation.created', RESERVATION_RELEASED: 'counter-reservation.released',
  COUNTER_STATUS_CHANGED: 'counter.status-changed', PRECHECK_STARTED: 'precheck.started', PRECHECK_UPDATED: 'precheck.updated',
  PRECHECK_SUBMITTED: 'precheck.submitted', OUTCHECK_STARTED: 'outcheck.started', OUTCHECK_UPDATED: 'outcheck.updated', OUTCHECK_SUBMITTED: 'outcheck.submitted',
  OUTCHECK_REJECTED: 'outcheck.rejected', OUTCHECK_APPROVED: 'outcheck.approved', ISSUE_CREATED: 'operational-issue.created',
  ISSUE_UPDATED: 'operational-issue.updated', ISSUE_RESOLVED: 'operational-issue.resolved', REPORT_PENDING: 'report.pending',
  REPORT_GENERATED: 'report.generated', REPORT_FAILED: 'report.failed', REPORT_JOB_STATUS: 'report-job.status-changed',
  REPORT_EMAIL_JOB_STATUS: 'report-email-job.status-changed', NOTIFICATION_NEW: 'notification.new',
  NOTIFICATION_READ: 'notification.read', NOTIFICATIONS_READ_ALL: 'notification.read-all',
} as const;

export type RealtimeEventName = typeof REALTIME_EVENTS[keyof typeof REALTIME_EVENTS];
export interface RealtimePayload { resourceId: string; updatedAt: string; status?: string; companyId?: string;
  dailyDutyId?: string; dailyCompanySessionId?: string; dailySessionFlightId?: string; movementCategoryId?: string;
  parentId?: string; display?: Record<string, string | number | boolean | null>; }
export interface RealtimeScope { userId?: string; companyId?: string; dailyDutyId?: string; movementCategoryId?: string;
  role?: Role; admins?: boolean; superAdmins?: boolean; authenticated?: boolean; }

const configuredOrigins = process.env.FRONTEND_ORIGIN;
if (!configuredOrigins && process.env.NODE_ENV === 'production') {
  throw new Error('FRONTEND_ORIGIN is required in production');
}
const allowedOrigins = (configuredOrigins ?? 'http://localhost:3001').split(',').map((origin) => origin.trim());

@WebSocketGateway({ cors: { origin: allowedOrigins, credentials: true }, namespace: 'realtime', transports: ['websocket', 'polling'] })
export class NotificationsGateway implements OnGatewayConnection, OnGatewayDisconnect {
  @WebSocketServer() server: Server;
  private readonly logger = new Logger(NotificationsGateway.name);

  constructor(private readonly jwt: JwtService, private readonly config: ConfigService, private readonly prisma: PrismaService,
    private readonly rbac: RolesPermissionsService) {}

  async handleConnection(client: Socket) {
    try {
      const token = this.accessToken(client);
      const payload = await this.jwt.verifyAsync<{ sub: string }>(token, { secret: this.config.get<string>('JWT_ACCESS_SECRET') });
      const user = await this.prisma.user.findUnique({ where: { id: payload.sub }, include: { company: true } });
      if (!user?.isActive || (user.role === Role.COMPANY_USER && (!user.company || !user.company.isActive))) throw new Error('Inactive identity');
      const permissions = await this.rbac.getUserPermissionCodes(user.id, user.role);
      client.data.user = { id: user.id, role: user.role, companyId: user.companyId, permissions };
      const rooms = new Set<string>(['authenticated', `user:${user.id}`, `role:${user.role}`]);
      if (user.companyId) rooms.add(`company:${user.companyId}`);
      if (user.role === Role.ADMIN || user.role === Role.SUPER_ADMIN) rooms.add('admins');
      if (user.role === Role.SUPER_ADMIN) rooms.add('super-admins');
      if (user.role === Role.MOVEMENT_SUPERVISOR) {
        const [assignments, duties] = await Promise.all([
          this.prisma.movementCategoryAssignment.findMany({ where: { userId: user.id, isActive: true }, select: { movementCategoryId: true } }),
          this.prisma.dailyDuty.findMany({ where: { movementSupervisorId: user.id, status: 'OPEN', expiresAt: { gt: new Date() } }, select: { id: true } }),
        ]);
        assignments.forEach(({ movementCategoryId }) => rooms.add(`movement-category:${movementCategoryId}`));
        duties.forEach(({ id }) => rooms.add(`duty:${id}`));
      }
      await client.join([...rooms]);
      client.emit('realtime.ready', { connectedAt: new Date().toISOString() });
    } catch {
      client.emit('realtime.error', { code: 'UNAUTHORIZED' });
      client.disconnect(true);
    }
  }

  handleDisconnect(client: Socket) { delete client.data.user; }

  emitScoped(event: RealtimeEventName, payload: RealtimePayload, scope: RealtimeScope) {
    if (!this.server) return;
    const rooms = this.scopeRooms(scope);
    if (!rooms.length) { this.logger.warn(`Suppressed unscoped realtime event ${event}`); return; }
    this.server.to(rooms).emit(event, payload);
  }

  emitNotification(notification: { id: string; type: string; title: string; message: string; targetUserId?: string | null;
    targetCompanyId?: string | null; targetRole?: Role | null; entityType?: string | null; entityId?: string | null; createdAt: Date }) {
    this.emitScoped(REALTIME_EVENTS.NOTIFICATION_NEW, { resourceId: notification.id, status: 'UNREAD',
      updatedAt: notification.createdAt.toISOString(), parentId: notification.entityId ?? undefined,
      display: { type: notification.type, title: notification.title, message: notification.message,
        entityType: notification.entityType ?? null } }, { userId: notification.targetUserId ?? undefined,
      companyId: notification.targetCompanyId ?? undefined, role: notification.targetRole ?? undefined,
      authenticated: !notification.targetUserId && !notification.targetCompanyId && !notification.targetRole });
  }

  private accessToken(client: Socket) {
    const authToken = typeof client.handshake.auth?.token === 'string' ? client.handshake.auth.token : undefined;
    const header = client.handshake.headers.authorization;
    const token = authToken ?? (header?.startsWith('Bearer ') ? header.slice(7) : undefined);
    if (!token) throw new Error('Missing token');
    return token;
  }

  private scopeRooms(scope: RealtimeScope) {
    return [...new Set([scope.userId && `user:${scope.userId}`, scope.companyId && `company:${scope.companyId}`,
      scope.dailyDutyId && `duty:${scope.dailyDutyId}`, scope.movementCategoryId && `movement-category:${scope.movementCategoryId}`,
      scope.role && `role:${scope.role}`, scope.admins && 'admins', scope.superAdmins && 'super-admins',
      scope.authenticated && 'authenticated'].filter((room): room is string => Boolean(room)))];
  }
}
