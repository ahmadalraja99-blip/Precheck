import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { CounterReservationStatus, CounterStatus, Prisma, Role, SessionStatus } from '@prisma/client';
import { paginate } from '../common/dto/pagination.dto';
import { AuthUser } from '../common/types/auth-user.type';
import { safeUserSelect } from '../common/utils/sanitize-user';
import { OperationAccessService } from '../operations/operation-access.service';
import { PrismaService } from '../prisma/prisma.service';
import {
  CounterReservationQueryDto,
  CounterStatusMapQueryDto,
} from './dto/counter-reservation-query.dto';
import { CreateCounterReservationDto } from './dto/create-counter-reservation.dto';

const reservationInclude = {
  counter: true,
  company: true,
  movementCategory: true,
  createdBy: { select: safeUserSelect },
  dailySessionFlight: { include: { flight: true } },
  dailyCompanySession: {
    include: {
      dailyDuty: { include: { movementSupervisor: { select: safeUserSelect } } },
    },
  },
} satisfies Prisma.CounterReservationInclude;

@Injectable()
export class CounterReservationsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly access: OperationAccessService,
  ) {}

  async create(sessionFlightId: string, dto: CreateCounterReservationDto, user: AuthUser) {
    const item = await this.access.assertCanModifySessionFlight(sessionFlightId, user);
    const reservedFrom = new Date(dto.reservedFrom);
    const reservedTo = new Date(dto.reservedTo);
    if (reservedFrom >= reservedTo) {
      throw new BadRequestException('reservedFrom must be before reservedTo');
    }
    if (
      user.role === Role.MOVEMENT_SUPERVISOR &&
      (reservedFrom < item.checkInStartsAt || reservedTo > item.checkInEndsAt)
    ) {
      throw new BadRequestException('Reservation must be inside the flight check-in window');
    }
    const counters = await this.prisma.counter.findMany({ where: { id: { in: dto.counterIds } } });
    if (counters.length !== dto.counterIds.length) throw new NotFoundException('One or more counters were not found');
    if (
      counters.some((counter) =>
        ([CounterStatus.UNAVAILABLE, CounterStatus.OUT_OF_SERVICE] as CounterStatus[]).includes(
          counter.status,
        ),
      )
    ) {
      throw new ConflictException('One or more counters are unavailable');
    }

    const conflicts = await this.prisma.counterReservation.findMany({
      where: {
        counterId: { in: dto.counterIds },
        status: { in: [CounterReservationStatus.SCHEDULED, CounterReservationStatus.ACTIVE] },
        reservedFrom: { lt: reservedTo },
        reservedTo: { gt: reservedFrom },
      },
      include: {
        counter: true,
        company: true,
        dailySessionFlight: { include: { flight: true } },
      },
    });
    const legacyConflicts = await this.prisma.sessionCounter.findMany({
      where: {
        counterId: { in: dto.counterIds },
        session: {
          status: {
            in: [
              SessionStatus.SCHEDULED,
              SessionStatus.PRECHECK_IN_PROGRESS,
              SessionStatus.PRECHECK_BLOCKED,
              SessionStatus.OPERATING,
              SessionStatus.OUTCHECK_IN_PROGRESS,
              SessionStatus.OUTCHECK_PENDING_APPROVAL,
              SessionStatus.OUTCHECK_REJECTED,
            ],
          },
          plannedStartAt: { lt: reservedTo },
          plannedEndAt: { gt: reservedFrom },
        },
      },
      include: { counter: true, session: { include: { company: true } } },
    });
    if (conflicts.length || legacyConflicts.length) {
      throw new ConflictException({
        message: 'Counter reservation conflict',
        conflicts: [
          ...conflicts.map((conflict) => ({
            counterCode: conflict.counter.code,
            companyName: conflict.company.name,
            flightNumber: conflict.dailySessionFlight.flight.flightNumber,
            reservedFrom: conflict.reservedFrom,
            reservedTo: conflict.reservedTo,
          })),
          ...legacyConflicts.map((conflict) => ({
            counterCode: conflict.counter.code,
            companyName: conflict.session.company.name,
            flightNumber: 'LEGACY_SESSION',
            reservedFrom: conflict.session.plannedStartAt,
            reservedTo: conflict.session.plannedEndAt,
          })),
        ],
      });
    }

    const duty = item.dailyCompanySession.dailyDuty;
    const isCarryOver = reservedTo > duty.expiresAt;
    const created = await this.prisma.$transaction(
      dto.counterIds.map((counterId) =>
        this.prisma.counterReservation.create({
          data: {
            counterId,
            dailySessionFlightId: item.id,
            dailyCompanySessionId: item.dailyCompanySessionId,
            companyId: item.companyId,
            movementCategoryId: item.movementCategoryId,
            reservedFrom,
            reservedTo,
            createdById: user.id,
            isCarryOver,
          },
          include: reservationInclude,
        }),
      ),
    );
    return {
      reservations: created,
      warning: isCarryOver
        ? 'This reservation extends beyond current duty expiration and will be marked as carry-over.'
        : undefined,
    };
  }

  async list(query: CounterReservationQueryDto, user: AuthUser) {
    const { skip, take, page, limit } = paginate(query);
    const day = query.date ? new Date(query.date) : undefined;
    const nextDay = day ? new Date(day.getTime() + 24 * 60 * 60 * 1000) : undefined;
    const where: Prisma.CounterReservationWhereInput = {
      companyId: user.role === Role.COMPANY_USER ? user.companyId ?? '__unlinked__' : query.companyId,
      counterId: query.counterId,
      movementCategoryId: query.movementCategoryId,
      dailyCompanySessionId: query.dailyCompanySessionId,
      dailySessionFlightId: query.dailySessionFlightId,
      status: query.status,
      isCarryOver: query.isCarryOver,
      reservedFrom: day ? { gte: day, lt: nextDay } : undefined,
      OR:
        user.role === Role.MOVEMENT_SUPERVISOR
          ? [
              { dailyCompanySession: { dailyDuty: { movementSupervisorId: user.id } } },
              { isCarryOver: true },
            ]
          : undefined,
    };
    const [items, total] = await this.prisma.$transaction([
      this.prisma.counterReservation.findMany({
        where,
        include: reservationInclude,
        skip,
        take,
        orderBy: { reservedFrom: 'desc' },
      }),
      this.prisma.counterReservation.count({ where }),
    ]);
    return { items, meta: { total, page, limit } };
  }

  async forFlight(sessionFlightId: string, user: AuthUser) {
    const item = await this.prisma.dailySessionFlight.findUnique({ where: { id: sessionFlightId } });
    if (!item) throw new NotFoundException('Session flight not found');
    this.access.assertCompanyScope(item.companyId, user);
    return this.prisma.counterReservation.findMany({
      where: { dailySessionFlightId: sessionFlightId },
      include: reservationInclude,
      orderBy: { counter: { code: 'asc' } },
    });
  }

  async statusMap(query: CounterStatusMapQueryDto, user: AuthUser) {
    const at = query.at ? new Date(query.at) : new Date();
    const counters = await this.prisma.counter.findMany({
      include: {
        counterReservations: {
          where: {
            status: { in: [CounterReservationStatus.SCHEDULED, CounterReservationStatus.ACTIVE] },
            reservedFrom: { lte: at },
            reservedTo: { gte: at },
            companyId: user.role === Role.COMPANY_USER ? user.companyId ?? '__unlinked__' : undefined,
          },
          include: {
            company: true,
            dailySessionFlight: { include: { flight: true } },
          },
          take: 1,
          orderBy: { reservedFrom: 'desc' },
        },
      },
      orderBy: { code: 'asc' },
    });
    return counters.map(({ counterReservations, ...counter }) => {
      const reservation = counterReservations[0];
      return {
        ...counter,
       status: reservation
  ? 'RESERVED'
  : counter.status === 'RESERVED'
    ? 'AVAILABLE'
    : counter.status,
        reservation: reservation
          ? {
              id: reservation.id,
              company: reservation.company,
              flight: reservation.dailySessionFlight.flight,
              reservedFrom: reservation.reservedFrom,
              reservedTo: reservation.reservedTo,
              isCarryOver: reservation.isCarryOver,
            }
          : null,
      };
    });
  }

  async changeStatus(
    id: string,
    status: CounterReservationStatus,
    user: AuthUser,
  ) {
    const reservation = await this.prisma.counterReservation.findUnique({ where: { id } });
    if (!reservation) throw new NotFoundException('Counter reservation not found');
    await this.access.assertCanModifySessionFlight(reservation.dailySessionFlightId, user);
    if (
      !([CounterReservationStatus.SCHEDULED, CounterReservationStatus.ACTIVE] as CounterReservationStatus[]).includes(
        reservation.status,
      )
    ) {
      throw new ConflictException('Counter reservation is already finalized');
    }
    return this.prisma.counterReservation.update({
      where: { id },
      data: { status },
      include: reservationInclude,
    });
  }
}
