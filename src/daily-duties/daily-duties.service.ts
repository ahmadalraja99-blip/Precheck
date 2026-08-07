import { ConflictException, ForbiddenException, Injectable, NotFoundException, Optional } from '@nestjs/common';
import {
  DailyDutyStatus,
  HandoverStatus,
  OperationalReportGenerationType,
  Prisma,
  Role,
} from '@prisma/client';
import { paginate } from '../common/dto/pagination.dto';
import { AuthUser } from '../common/types/auth-user.type';
import { safeUserSelect } from '../common/utils/sanitize-user';
import { DutyExpirationService } from '../operations/duty-expiration.service';
import { OperationAccessService } from '../operations/operation-access.service';
import { PrismaService } from '../prisma/prisma.service';
import { ActivateDailyDutyDto } from './dto/activate-daily-duty.dto';
import { CloseDailyDutyDto } from './dto/close-daily-duty.dto';
import { DailyDutyQueryDto } from './dto/daily-duty-query.dto';
import { AuditService } from '../audit/audit.service';
import { NotificationsGateway, REALTIME_EVENTS, RealtimeEventName } from '../notifications/notifications.gateway';

const dutyInclude = {
  movementCategory: true,
  movementSupervisor: { select: safeUserSelect },
  createdBy: { select: safeUserSelect },
} satisfies Prisma.DailyDutyInclude;

@Injectable()
export class DailyDutiesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly expiration: DutyExpirationService,
    private readonly access: OperationAccessService,
    private readonly audit: AuditService,
    @Optional() private readonly realtime?: NotificationsGateway,
  ) {}

  async activate(dto: ActivateDailyDutyDto, user: AuthUser) {
    await this.expiration.expireDueDuties();
    const category = await this.prisma.movementCategory.findUnique({ where: { id: dto.movementCategoryId } });
    if (!category?.isActive) throw new NotFoundException('Active movement category not found');
    if (user.role === Role.MOVEMENT_SUPERVISOR) {
      const assignment = await this.prisma.movementCategoryAssignment.findFirst({
        where: { userId: user.id, movementCategoryId: dto.movementCategoryId, isActive: true },
      });
      if (!assignment) throw new ForbiddenException('Movement category is not assigned to this supervisor');
    }

    let duty: { id: string; movementCategoryId: string } | undefined;
    let event: RealtimeEventName = REALTIME_EVENTS.DUTY_ACTIVATED;
    for (let attempt = 0; attempt < 3 && !duty; attempt += 1) {
      try {
        duty = await this.prisma.$transaction(
          async (tx) => {
            const active = await tx.dailyDuty.findFirst({
              where: { status: DailyDutyStatus.OPEN, expiresAt: { gt: new Date() } },
              orderBy: { activatedAt: 'desc' },
            });
            if (active) {
              if (
                active.movementSupervisorId === user.id &&
                active.movementCategoryId === dto.movementCategoryId
              ) {
                event = REALTIME_EVENTS.DUTY_RESUMED;
                await this.audit.record({ user, action: 'RESUME_DAILY_DUTY', entityType: 'DailyDuty',
                  entityId: active.id, metadata: { movementCategoryId: active.movementCategoryId } }, tx);
                return active;
              }
              throw new ConflictException('Another movement duty is already active');
            }
            const activatedAt = new Date();
            const expiresAt = new Date(activatedAt.getTime() + 24 * 60 * 60 * 1000);
            const created = await tx.dailyDuty.create({
              data: {
                movementCategoryId: dto.movementCategoryId,
                movementSupervisorId: user.id,
                createdById: user.id,
                activatedAt,
                expiresAt,
              },
            });
            await this.audit.record({ user, action: 'ACTIVATE_DAILY_DUTY', entityType: 'DailyDuty', entityId: created.id,
              metadata: { movementCategoryId: created.movementCategoryId, activatedAt: activatedAt.toISOString(),
                expiresAt: expiresAt.toISOString() } }, tx);
            return created;
          },
          { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
        );
      } catch (error) {
        if (
          error instanceof Prisma.PrismaClientKnownRequestError &&
          (error.code === 'P2034' || error.code === 'P2002') &&
          attempt < 2
        ) {
          continue;
        }
        if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002')
          throw new ConflictException('Another movement duty is already active');
        throw error;
      }
    }
    if (!duty) throw new ConflictException('Another movement duty is already active');
    const result = await this.prisma.dailyDuty.findUnique({ where: { id: duty.id }, include: dutyInclude });
    this.realtime?.emitScoped(event, { resourceId: duty.id, dailyDutyId: duty.id,
      movementCategoryId: duty.movementCategoryId, status: 'OPEN', updatedAt: new Date().toISOString() },
    { userId: user.id, movementCategoryId: duty.movementCategoryId, admins: true });
    return result;
  }

  active(user: AuthUser) {
    return this.access.activeDutyForUser(user);
  }

  async status(user: AuthUser) {
    await this.expiration.expireDueDuties();
    const duty = await this.prisma.dailyDuty.findFirst({ where: { status: DailyDutyStatus.OPEN },
      include: dutyInclude, orderBy: { activatedAt: 'desc' } });
    if (!duty) return { active: false, duty: null, mayManage: false, remainingMs: 0, carryOver: { pending: 0, accepted: 0 } };
    const [pending, accepted] = await Promise.all([
      this.prisma.dailySessionFlight.count({ where: { isCarryOver: true, handoverStatus: HandoverStatus.PENDING } }),
      this.prisma.dailySessionFlight.count({ where: { isCarryOver: true, carriedToDailyDutyId: duty.id,
        handoverStatus: { in: [HandoverStatus.ACCEPTED, HandoverStatus.COMPLETED] } } }),
    ]);
    const mayManage = user.role === Role.SUPER_ADMIN || user.role === Role.ADMIN || duty.movementSupervisorId === user.id;
    if (user.role === Role.MOVEMENT_SUPERVISOR && duty.movementSupervisorId === user.id)
      await this.audit.record({ user, action: 'RESUME_DAILY_DUTY', entityType: 'DailyDuty', entityId: duty.id });
    return { active: true, duty, mayManage, remainingMs: Math.max(0, duty.expiresAt.getTime() - Date.now()),
      expired: duty.expiresAt <= new Date(), carryOver: { pending, accepted } };
  }

  async carryOver(user: AuthUser) {
    const activeDuty = await this.access.activeDutyForUser(user);
    if (!activeDuty) throw new ForbiddenException('An active daily duty is required');
    return this.prisma.dailySessionFlight.findMany({
      where: { isCarryOver: true, handoverStatus: { in: ['PENDING', 'ACCEPTED'] } },
      include: {
        company: true,
        flight: true,
        movementCategory: true,
        dailyCompanySession: {
          include: {
            dailyDuty: { include: { movementSupervisor: { select: safeUserSelect } } },
          },
        },
        counterReservations: { include: { counter: true } },
        operationalIssues: { where: { status: { in: ['OPEN', 'IN_PROGRESS'] } } },
        carriedToMovementCategory: true,
      },
      orderBy: [{ handoverStatus: 'asc' }, { carriedAt: 'asc' }],
    });
  }

  async list(query: DailyDutyQueryDto, user: AuthUser) {
    await this.expiration.expireDueDuties();
    const { skip, take, page, limit } = paginate(query);
    const day = query.date ? new Date(query.date) : undefined;
    const nextDay = day ? new Date(day.getTime() + 24 * 60 * 60 * 1000) : undefined;
    const where: Prisma.DailyDutyWhereInput = {
      movementCategoryId: query.movementCategoryId,
      movementSupervisorId:
        user.role === Role.MOVEMENT_SUPERVISOR ? user.id : query.movementSupervisorId,
      dailyCompanySessions:
        user.role === Role.COMPANY_USER
          ? { some: { companyId: user.companyId ?? '__unlinked__' } }
          : undefined,
      status: query.status,
      activatedAt: day ? { gte: day, lt: nextDay } : undefined,
    };
    const [items, total] = await this.prisma.$transaction([
      this.prisma.dailyDuty.findMany({ where, include: dutyInclude, skip, take, orderBy: { activatedAt: 'desc' } }),
      this.prisma.dailyDuty.count({ where }),
    ]);
    return { items, meta: { total, page, limit } };
  }

  async find(id: string, user: AuthUser) {
    const duty = await this.prisma.dailyDuty.findUnique({
      where: { id },
      include: {
        ...dutyInclude,
        dailyCompanySessions: { include: { company: true } },
      },
    });
    if (!duty) throw new NotFoundException('Daily duty not found');
    if (
      user.role === Role.COMPANY_USER &&
      !duty.dailyCompanySessions.some((session) => session.companyId === user.companyId)
    ) {
      throw new ForbiddenException('Daily duty is not assigned to this company');
    }
    if (user.role === Role.MOVEMENT_SUPERVISOR && duty.movementSupervisorId !== user.id) {
      throw new ForbiddenException('Daily duty belongs to another supervisor');
    }
    return duty;
  }

  async finish(
    id: string,
    status: DailyDutyStatus,
    dto: CloseDailyDutyDto,
    user: AuthUser,
  ) {
    let duty = await this.prisma.dailyDuty.findUnique({ where: { id } });
    if (!duty) throw new NotFoundException('Daily duty not found');
    if (user.role === Role.MOVEMENT_SUPERVISOR && duty.movementSupervisorId !== user.id) {
      throw new ForbiddenException('Daily duty belongs to another supervisor');
    }
    if (status === DailyDutyStatus.CLOSED && duty.status === DailyDutyStatus.OPEN) {
      await this.expiration.markCarryOver(id, new Date());
      duty = await this.prisma.dailyDuty.findUniqueOrThrow({ where: { id } });
    }
    if (status === DailyDutyStatus.CLOSED && duty.status !== DailyDutyStatus.OPEN && duty.status !== DailyDutyStatus.EXPIRED)
      throw new ConflictException('Daily duty cannot be closed from its current state');
    if (status === DailyDutyStatus.CLOSED) {
      const [activeFlights, pendingHandovers, openSessions] = await Promise.all([
        this.prisma.dailySessionFlight.count({ where: { dailyCompanySession: { dailyDutyId: id }, isCarryOver: false,
          status: { notIn: ['CLOSED', 'CANCELLED'] } } }),
        this.prisma.dailySessionFlight.count({ where: { carriedFromDailyDutyId: id, isCarryOver: true,
          handoverStatus: HandoverStatus.PENDING } }),
        this.prisma.dailyCompanySession.count({ where: { dailyDutyId: id,
          status: { in: ['SCHEDULED', 'OPEN'] } } }),
      ]);
      if (activeFlights || pendingHandovers || openSessions) {
        const blockers = { activeFlights, pendingHandovers, openSessions };
        await this.audit.record({ user, action: 'BLOCK_DAILY_DUTY_FINAL_CLOSE', entityType: 'DailyDuty', entityId: id,
          result: 'FAILED', metadata: blockers });
        throw new ConflictException({ message: 'Daily duty cannot close while operational blockers remain', blockers });
      }
    } else if (duty.status !== DailyDutyStatus.OPEN) throw new ConflictException('Daily duty is not open');
    const changed = await this.prisma.dailyDuty.updateMany({ where: { id, status: duty.status },
      data: { status, closedAt: new Date(), notes: dto.notes ?? duty.notes } });
    if (changed.count !== 1) throw new ConflictException('Daily duty changed concurrently');
    const updated = await this.prisma.dailyDuty.findUniqueOrThrow({ where: { id }, include: dutyInclude });
    await this.expiration.generateDutySnapshots(
      id,
      OperationalReportGenerationType.AUTOMATIC_FINAL_CLOSE,
    );
    await this.audit.record({ user, action: status === DailyDutyStatus.CLOSED ? 'CLOSE_DAILY_DUTY' : 'CANCEL_DAILY_DUTY',
      entityType: 'DailyDuty', entityId: id, metadata: { previousStatus: duty.status, nextStatus: status } });
    this.realtime?.emitScoped(REALTIME_EVENTS.DUTY_CLOSED, { resourceId: id, dailyDutyId: id,
      movementCategoryId: updated.movementCategoryId, status, updatedAt: updated.updatedAt.toISOString() },
    { userId: updated.movementSupervisorId, movementCategoryId: updated.movementCategoryId, admins: true });
    return updated;
  }
}
