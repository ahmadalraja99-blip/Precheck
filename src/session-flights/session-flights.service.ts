import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  Optional,
} from '@nestjs/common';
import {
  CounterReservationStatus,
  DailyDutyStatus,
  DailySessionFlightStatus,
  HandoverStatus,
  Prisma,
  Role,
} from '@prisma/client';
import { paginate } from '../common/dto/pagination.dto';
import { lockDailySessionFlightRows } from '../common/database/daily-session-flight-lock';
import { AuthUser } from '../common/types/auth-user.type';
import { safeUserSelect } from '../common/utils/sanitize-user';
import { OperationAccessService } from '../operations/operation-access.service';
import { PrismaService } from '../prisma/prisma.service';
import { AddSessionFlightDto } from './dto/add-session-flight.dto';
import { SessionFlightQueryDto } from './dto/session-flight-query.dto';
import { AuditService } from '../audit/audit.service';
import { NotificationsGateway, REALTIME_EVENTS } from '../notifications/notifications.gateway';
import {
  assertDailySessionFlightTransitionAllowed,
  assertPublicDailySessionFlightStatusChangeAllowed,
} from './daily-session-flight-status-machine';

const itemInclude = {
  company: true,
  flight: true,
  movementCategory: true,
  createdBy: { select: safeUserSelect },
  dailyCompanySession: {
    include: {
      company: true,
      dailyDuty: {
        include: {
          movementCategory: true,
          movementSupervisor: { select: safeUserSelect },
        },
      },
    },
  },
  counterReservations: { include: { counter: true } },
  flightReports: {
    select: {
      id: true, dailySessionFlightId: true, companyId: true, movementCategoryId: true,
      generatedById: true, format: true, generationType: true, status: true,
      errorMessage: true, mimeType: true, fileSize: true, checksum: true,
      generatedAt: true, templateVersion: true, metadata: true, createdAt: true, updatedAt: true,
    },
  },
} satisfies Prisma.DailySessionFlightInclude;

const duplicateAttachmentMessage =
  'This flight is already attached to the selected company session.';

@Injectable()
export class SessionFlightsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly access: OperationAccessService,
    private readonly audit: AuditService,
    @Optional() private readonly realtime?: NotificationsGateway,
  ) {}

  async add(sessionId: string, dto: AddSessionFlightDto, user: AuthUser) {
    if ((!dto.flightId && !dto.flight) || (dto.flightId && dto.flight)) {
      throw new BadRequestException('Provide either flightId or flight');
    }
    const session = await this.access.assertCanModifySession(sessionId, user);
    const checkInStartsAt = new Date(dto.checkInStartsAt);
    const checkInEndsAt = new Date(dto.checkInEndsAt);
    if (checkInStartsAt >= checkInEndsAt) {
      throw new BadRequestException('checkInStartsAt must be before checkInEndsAt');
    }
    if (dto.flight && dto.flight.companyId !== session.companyId) {
      throw new BadRequestException('Flight company must match daily company session');
    }
    if (
      dto.flight?.scheduledArrivalAt &&
      new Date(dto.flight.scheduledArrivalAt) <= new Date(dto.flight.scheduledDepartureAt)
    ) {
      throw new BadRequestException('scheduledArrivalAt must be after scheduledDepartureAt');
    }

    let created: { id: string };
    try {
      created = await this.prisma.$transaction(async (tx) => {
        const flight = dto.flightId
          ? await tx.flight.findUnique({ where: { id: dto.flightId } })
          : await tx.flight.create({
              data: {
                ...dto.flight!,
                scheduledDepartureAt: new Date(dto.flight!.scheduledDepartureAt),
                scheduledArrivalAt: dto.flight!.scheduledArrivalAt
                  ? new Date(dto.flight!.scheduledArrivalAt)
                  : undefined,
              },
            });
        if (!flight) throw new NotFoundException('Flight not found');
        if (flight.companyId !== session.companyId) {
          throw new BadRequestException('Flight company must match daily company session');
        }
        const existing = await tx.dailySessionFlight.findFirst({
          where: { dailyCompanySessionId: sessionId, flightId: flight.id },
        });
        if (existing) throw new ConflictException(duplicateAttachmentMessage);
        const carryOver = checkInEndsAt > session.dailyDuty.expiresAt;
        return tx.dailySessionFlight.create({
          data: {
            dailyCompanySessionId: session.id,
            flightId: flight.id,
            companyId: session.companyId,
            movementCategoryId: session.movementCategoryId,
            checkInStartsAt,
            checkInEndsAt,
            notes: dto.notes,
            createdById: user.id,
            isCarryOver: carryOver,
            handoverStatus: carryOver ? HandoverStatus.PENDING : HandoverStatus.NONE,
            carriedFromDailyDutyId: carryOver ? session.dailyDutyId : undefined,
          },
        });
      });
    } catch (error) {
      if (this.isDuplicateAttachmentConflict(error)) {
        throw new ConflictException(duplicateAttachmentMessage);
      }
      throw error;
    }
    const sessionFlight = await this.prisma.dailySessionFlight.findUnique({
      where: { id: created.id },
      include: itemInclude,
    });
    if (sessionFlight) this.publish(sessionFlight.isCarryOver ? REALTIME_EVENTS.FLIGHT_CARRY_OVER_CREATED : REALTIME_EVENTS.FLIGHT_CREATED, sessionFlight);
    if (sessionFlight) await this.audit.record({ user, action: 'CREATE_DAILY_SESSION_FLIGHT',
      entityType: 'DailySessionFlight', entityId: sessionFlight.id,
      metadata: { dailyCompanySessionId: sessionFlight.dailyCompanySessionId, flightId: sessionFlight.flightId,
        companyId: sessionFlight.companyId, movementCategoryId: sessionFlight.movementCategoryId,
        isCarryOver: sessionFlight.isCarryOver } });
    return {
      sessionFlight,
      warning:
        sessionFlight?.isCarryOver
          ? 'This flight extends beyond current duty expiration and will be marked as carry-over.'
          : undefined,
    };
  }

  async listForSession(sessionId: string, user: AuthUser) {
    const session = await this.prisma.dailyCompanySession.findUnique({
      where: { id: sessionId },
      include: { dailyDuty: true },
    });
    if (!session) throw new NotFoundException('Daily company session not found');
    this.assertCanReadParentSession(session, user);
    return this.prisma.dailySessionFlight.findMany({
      where: { dailyCompanySessionId: sessionId },
      include: itemInclude,
      orderBy: { checkInStartsAt: 'asc' },
    });
  }

  async list(query: SessionFlightQueryDto, user: AuthUser) {
    const { skip, take, page, limit } = paginate(query);
    const day = query.date ? new Date(query.date) : undefined;
    const nextDay = day ? new Date(day.getTime() + 24 * 60 * 60 * 1000) : undefined;
    const readScope = await this.buildReadScope(user);
    const where: Prisma.DailySessionFlightWhereInput = {
      companyId: user.role === Role.COMPANY_USER ? user.companyId ?? '__unlinked__' : query.companyId,
      movementCategoryId: query.movementCategoryId,
      checkInStartsAt: day ? { gte: day, lt: nextDay } : undefined,
      flight: query.flightNumber
        ? { flightNumber: { contains: query.flightNumber, mode: 'insensitive' } }
        : undefined,
      status: query.status,
      isCarryOver: query.isCarryOver,
      handoverStatus: query.handoverStatus,
      AND: readScope,
    };
    const [items, total] = await this.prisma.$transaction([
      this.prisma.dailySessionFlight.findMany({
        where,
        include: itemInclude,
        skip,
        take,
        orderBy: { checkInStartsAt: 'desc' },
      }),
      this.prisma.dailySessionFlight.count({ where }),
    ]);
    return { items, meta: { total, page, limit } };
  }

  async find(id: string, user: AuthUser) {
    const item = await this.prisma.dailySessionFlight.findUnique({ where: { id }, include: itemInclude });
    if (!item) throw new NotFoundException('Session flight not found');
    this.access.assertCompanyScope(item.companyId, user);
    if (
      user.role === Role.MOVEMENT_SUPERVISOR &&
      !(await this.canMovementSupervisorRead(item, user.id))
    ) {
      throw new ForbiddenException('Access denied');
    }
    return item;
  }

  private assertCanReadParentSession(
    session: { companyId: string; dailyDuty: { movementSupervisorId: string } },
    user: AuthUser,
  ) {
    if (user.role === Role.COMPANY_USER) {
      if (!user.companyId || session.companyId !== user.companyId) {
        throw new ForbiddenException('Access denied');
      }
      return;
    }
    if (
      user.role === Role.MOVEMENT_SUPERVISOR &&
      session.dailyDuty.movementSupervisorId !== user.id
    ) {
      throw new ForbiddenException('Access denied');
    }
  }

  private async buildReadScope(
    user: AuthUser,
  ): Promise<Prisma.DailySessionFlightWhereInput | undefined> {
    if (user.role !== Role.MOVEMENT_SUPERVISOR) return undefined;
    const activeDutyId = await this.getActiveDutyId(user.id);
    return {
      OR: [
        { dailyCompanySession: { dailyDuty: { movementSupervisorId: user.id } } },
        ...(activeDutyId
          ? [
              {
                isCarryOver: true,
                handoverStatus: { in: [HandoverStatus.ACCEPTED, HandoverStatus.COMPLETED] },
                carriedToDailyDutyId: activeDutyId,
              } satisfies Prisma.DailySessionFlightWhereInput,
            ]
          : []),
      ],
    };
  }

  private async canMovementSupervisorRead(
    item: {
      isCarryOver: boolean;
      handoverStatus: HandoverStatus;
      carriedToDailyDutyId: string | null;
      dailyCompanySession: { dailyDuty: { movementSupervisorId: string } };
    },
    userId: string,
  ) {
    if (item.dailyCompanySession.dailyDuty.movementSupervisorId === userId) return true;
    if (
      !item.isCarryOver ||
      (item.handoverStatus !== HandoverStatus.ACCEPTED &&
        item.handoverStatus !== HandoverStatus.COMPLETED) ||
      !item.carriedToDailyDutyId
    ) {
      return false;
    }
    return item.carriedToDailyDutyId === (await this.getActiveDutyId(userId));
  }

  private async getActiveDutyId(userId: string) {
    const duty = await this.prisma.dailyDuty.findFirst({
      where: {
        movementSupervisorId: userId,
        status: DailyDutyStatus.OPEN,
        expiresAt: { gt: new Date() },
      },
      select: { id: true },
      orderBy: { activatedAt: 'desc' },
    });
    return duty?.id;
  }

  private isDuplicateAttachmentConflict(error: unknown) {
    if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== 'P2002') {
      return false;
    }
    const target = error.meta?.target;
    return (
      Array.isArray(target) &&
      target.length === 2 &&
      target.includes('dailyCompanySessionId') &&
      target.includes('flightId')
    );
  }

  async updatePublicStatus(
    id: string,
    status: DailySessionFlightStatus,
    user: AuthUser,
  ) {
    assertPublicDailySessionFlightStatusChangeAllowed(status);
    await this.access.assertCanModifySessionFlight(id, user);
    const updated = await this.prisma.$transaction(async (tx) => {
      const locked = await lockDailySessionFlightRows(tx, [id]);
      if (!locked.length) throw new NotFoundException('Session flight not found');
      const item = await tx.dailySessionFlight.findUnique({ where: { id } });
      if (!item) throw new NotFoundException('Session flight not found');

      assertPublicDailySessionFlightStatusChangeAllowed(status);
      assertDailySessionFlightTransitionAllowed(item.status, status);

      await tx.counterReservation.updateMany({
        where: {
          dailySessionFlightId: id,
          status: { in: [CounterReservationStatus.SCHEDULED, CounterReservationStatus.ACTIVE] },
        },
        data: { status: CounterReservationStatus.CANCELLED },
      });
      return tx.dailySessionFlight.update({
        where: { id },
        data: { status },
        include: itemInclude,
      });
    });
    this.publish(REALTIME_EVENTS.FLIGHT_STATUS_CHANGED, updated);
    return updated;
  }

  async acceptCarryOver(id: string, user: AuthUser) {
    const duty = await this.access.activeDutyForUser(user);
    if (!duty) throw new ForbiddenException('An active daily duty is required');
    const updated = await this.prisma.$transaction(async (tx) => {
      const locked = await lockDailySessionFlightRows(tx, [id]);
      if (!locked.length) throw new NotFoundException('Session flight not found');
      const item = await tx.dailySessionFlight.findUnique({ where: { id } });
      if (!item) throw new NotFoundException('Session flight not found');
      if (!item.isCarryOver) throw new BadRequestException('Session flight is not carry-over');
      if (item.handoverStatus === HandoverStatus.ACCEPTED && item.carriedToDailyDutyId === duty.id)
        return tx.dailySessionFlight.findUniqueOrThrow({ where: { id }, include: itemInclude });
      if (item.handoverStatus !== HandoverStatus.PENDING || item.carriedToDailyDutyId)
        throw new ConflictException('Carry-over handover was already accepted by another duty');
      if (item.carriedFromDailyDutyId === duty.id) throw new ConflictException('Source duty cannot accept its own handover');
      const acceptedAt = new Date();
      const updated = await tx.dailySessionFlight.update({ where: { id }, data: {
        handoverStatus: HandoverStatus.ACCEPTED, carriedToDailyDutyId: duty.id,
        carriedToMovementCategoryId: duty.movementCategoryId, handoverAcceptedAt: acceptedAt,
        handoverAcceptedById: user.id }, include: itemInclude });
      await this.audit.record({ user, action: 'ACCEPT_DAILY_SESSION_FLIGHT_HANDOVER', entityType: 'DailySessionFlight',
        entityId: id, metadata: { sourceDutyId: item.carriedFromDailyDutyId, destinationDutyId: duty.id,
          originalMovementCategoryId: item.movementCategoryId, newMovementCategoryId: duty.movementCategoryId,
          acceptedAt: acceptedAt.toISOString() } }, tx);
      return updated;
    });
    this.publish(REALTIME_EVENTS.HANDOVER_ACCEPTED, updated);
    return updated;
  }

  private publish(event: typeof REALTIME_EVENTS.FLIGHT_CREATED | typeof REALTIME_EVENTS.FLIGHT_CARRY_OVER_CREATED |
    typeof REALTIME_EVENTS.FLIGHT_STATUS_CHANGED | typeof REALTIME_EVENTS.HANDOVER_ACCEPTED,
    flight: { id: string; companyId: string; dailyCompanySessionId: string; movementCategoryId: string;
      carriedToDailyDutyId?: string | null; status: DailySessionFlightStatus; updatedAt: Date }) {
    this.realtime?.emitScoped(event, { resourceId: flight.id, dailySessionFlightId: flight.id,
      dailyCompanySessionId: flight.dailyCompanySessionId, companyId: flight.companyId,
      movementCategoryId: flight.movementCategoryId, dailyDutyId: flight.carriedToDailyDutyId ?? undefined,
      status: flight.status, updatedAt: flight.updatedAt.toISOString() },
    { companyId: flight.companyId, dailyDutyId: flight.carriedToDailyDutyId ?? undefined,
      movementCategoryId: flight.movementCategoryId, admins: true });
  }
}
