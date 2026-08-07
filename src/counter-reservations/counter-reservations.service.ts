import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  Optional,
} from "@nestjs/common";
import {
  CounterReservationStatus,
  CounterStatus,
  DailyDutyStatus,
  DailySessionFlightStatus,
  HandoverStatus,
  Prisma,
  Role,
  SessionStatus,
} from "@prisma/client";
import { paginate } from "../common/dto/pagination.dto";
import { AuthUser } from "../common/types/auth-user.type";
import { safeUserSelect } from "../common/utils/sanitize-user";
import { OperationAccessService } from "../operations/operation-access.service";
import { PrismaService } from "../prisma/prisma.service";
import {
  CounterReservationQueryDto,
  CounterStatusMapQueryDto,
} from "./dto/counter-reservation-query.dto";
import { CreateCounterReservationDto } from "./dto/create-counter-reservation.dto";
import { lockCounterRows } from "../common/database/counter-lock";
import { lockDailySessionFlightRows } from "../common/database/daily-session-flight-lock";
import { lockCounterReservationRows } from "../common/database/precheck-lock";
import type { CounterStatusMapItem } from "./types/counter-status-map.types";
import { NotificationsGateway, REALTIME_EVENTS } from "../notifications/notifications.gateway";
import { AuditService } from "../audit/audit.service";

const reservationInclude = {
  counter: true,
  company: true,
  movementCategory: true,
  createdBy: { select: safeUserSelect },
  dailySessionFlight: { include: { flight: true } },
  dailyCompanySession: {
    include: {
      dailyDuty: {
        include: { movementSupervisor: { select: safeUserSelect } },
      },
    },
  },
} satisfies Prisma.CounterReservationInclude;

const authorizationFlightInclude = {
  dailyCompanySession: { include: { dailyDuty: true } },
} satisfies Prisma.DailySessionFlightInclude;

type AuthorizationFlight = Prisma.DailySessionFlightGetPayload<{
  include: typeof authorizationFlightInclude;
}>;

@Injectable()
export class CounterReservationsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly access: OperationAccessService,
    @Optional() private readonly realtime?: NotificationsGateway,
    @Optional() private readonly audit?: AuditService,
  ) {}

  async create(
    sessionFlightId: string,
    dto: CreateCounterReservationDto,
    user: AuthUser,
  ) {
    const item = await this.getSessionFlightForModification(
      sessionFlightId,
      user,
    );
    const reservedFrom = new Date(dto.reservedFrom);
    const reservedTo = new Date(dto.reservedTo);
    if (reservedFrom >= reservedTo) {
      throw new BadRequestException("reservedFrom must be before reservedTo");
    }
    if (
      user.role === Role.MOVEMENT_SUPERVISOR &&
      (reservedFrom < item.checkInStartsAt || reservedTo > item.checkInEndsAt)
    ) {
      throw new BadRequestException(
        "Reservation must be inside the flight check-in window",
      );
    }
    const duty = item.dailyCompanySession.dailyDuty;
    const isCarryOver = reservedTo > duty.expiresAt;
    const created = await this.prisma.$transaction(async (tx) => {
      const lockedFlights = await lockDailySessionFlightRows(tx, [
        sessionFlightId,
      ]);
      if (!lockedFlights.length)
        throw new NotFoundException("Session flight not found");
      const persistedFlight = await tx.dailySessionFlight.findUnique({
        where: { id: sessionFlightId },
        select: { status: true },
      });
      if (persistedFlight?.status !== DailySessionFlightStatus.SCHEDULED) {
        throw new ConflictException(
          "Counter Reservations can only be added while the Flight is scheduled.",
        );
      }
      const lockedCounters = await lockCounterRows(tx, dto.counterIds);
      if (lockedCounters.length !== dto.counterIds.length) {
        throw new NotFoundException("One or more counters were not found");
      }
      const counters = await tx.counter.findMany({
        where: { id: { in: dto.counterIds } },
      });
      if (
        counters.some((counter) => !counter.isActive ||
          (
            [
              CounterStatus.UNAVAILABLE,
              CounterStatus.OUT_OF_SERVICE,
            ] as CounterStatus[]
          ).includes(counter.status),
        )
      ) {
        throw new ConflictException("One or more counters are unavailable");
      }

      const conflicts = await tx.counterReservation.findMany({
        where: {
          counterId: { in: dto.counterIds },
          status: {
            in: [
              CounterReservationStatus.SCHEDULED,
              CounterReservationStatus.ACTIVE,
            ],
          },
          reservedFrom: { lt: reservedTo },
          reservedTo: { gt: reservedFrom },
        },
        include: {
          counter: true,
          company: true,
          dailySessionFlight: { include: { flight: true } },
        },
      });
      const legacyConflicts = await tx.sessionCounter.findMany({
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
          message: "Counter reservation conflict",
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
              flightNumber: "LEGACY_SESSION",
              reservedFrom: conflict.session.plannedStartAt,
              reservedTo: conflict.session.plannedEndAt,
            })),
          ],
        });
      }

      return Promise.all(
        dto.counterIds.map((counterId) =>
          tx.counterReservation.create({
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
    });
    await this.audit?.record({ user, action: 'CREATE_COUNTER_RESERVATIONS', entityType: 'DailySessionFlight',
      entityId: sessionFlightId, metadata: { reservationIds: created.map(({ id }) => id),
        counterIds: dto.counterIds, reservedFrom: reservedFrom.toISOString(), reservedTo: reservedTo.toISOString(),
        isCarryOver } });
    this.publish(REALTIME_EVENTS.RESERVATION_CREATED, created[0]);
    return {
      reservations: created,
      warning: isCarryOver
        ? "This reservation extends beyond current duty expiration and will be marked as carry-over."
        : undefined,
    };
  }

  async list(query: CounterReservationQueryDto, user: AuthUser) {
    const { skip, take, page, limit } = paginate(query);
    const day = query.date ? new Date(query.date) : undefined;
    const nextDay = day
      ? new Date(day.getTime() + 24 * 60 * 60 * 1000)
      : undefined;
    const readScope = await this.buildReadScope(user);
    const where: Prisma.CounterReservationWhereInput = {
      companyId:
        user.role === Role.COMPANY_USER
          ? (user.companyId ?? "__unlinked__")
          : query.companyId,
      counterId: query.counterId,
      movementCategoryId: query.movementCategoryId,
      dailyCompanySessionId: query.dailyCompanySessionId,
      dailySessionFlightId: query.dailySessionFlightId,
      status: query.status,
      isCarryOver: query.isCarryOver,
      reservedFrom: day ? { gte: day, lt: nextDay } : undefined,
      AND: readScope,
    };
    const [items, total] = await this.prisma.$transaction([
      this.prisma.counterReservation.findMany({
        where,
        include: reservationInclude,
        skip,
        take,
        orderBy: { reservedFrom: "desc" },
      }),
      this.prisma.counterReservation.count({ where }),
    ]);
    return { items, meta: { total, page, limit } };
  }

  async forFlight(sessionFlightId: string, user: AuthUser) {
    const item = await this.prisma.dailySessionFlight.findUnique({
      where: { id: sessionFlightId },
      include: authorizationFlightInclude,
    });
    if (!item) throw new NotFoundException("Session flight not found");
    await this.assertCanReadFlightReservations(item, user);
    return this.prisma.counterReservation.findMany({
      where: { dailySessionFlightId: sessionFlightId },
      include: reservationInclude,
      orderBy: { counter: { code: "asc" } },
    });
  }

  async statusMap(
    query: CounterStatusMapQueryDto,
    _user: AuthUser,
  ): Promise<CounterStatusMapItem[]> {
    const at = query.at ? new Date(query.at) : new Date();
    const [counters, operationalOccupancy, legacyOccupancy] = await Promise.all(
      [
        this.prisma.counter.findMany({
          select: { id: true, code: true, name: true, status: true },
          orderBy: { code: "asc" },
        }),
        this.prisma.counterReservation.findMany({
          where: {
            status: {
              in: [
                CounterReservationStatus.SCHEDULED,
                CounterReservationStatus.ACTIVE,
              ],
            },
            reservedFrom: { lte: at },
            reservedTo: { gt: at },
          },
          select: { counterId: true },
          distinct: ["counterId"],
        }),
        this.prisma.sessionCounter.findMany({
          where: {
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
              plannedStartAt: { lte: at },
              plannedEndAt: { gt: at },
            },
          },
          select: { counterId: true },
          distinct: ["counterId"],
        }),
      ],
    );
    const occupiedCounterIds = new Set([
      ...operationalOccupancy.map(({ counterId }) => counterId),
      ...legacyOccupancy.map(({ counterId }) => counterId),
    ]);

    return counters.map((counter) => ({
      counterId: counter.id,
      code: counter.code,
      name: counter.name,
      storedStatus: counter.status,
      occupancyStatus: occupiedCounterIds.has(counter.id)
        ? "OCCUPIED"
        : "AVAILABLE",
    }));
  }

  async changeStatus(
    id: string,
    status: CounterReservationStatus,
    user: AuthUser,
  ) {
    const reservation = await this.prisma.counterReservation.findUnique({
      where: { id },
    });
    if (!reservation)
      throw new NotFoundException("Counter reservation not found");
    await this.getSessionFlightForModification(
      reservation.dailySessionFlightId,
      user,
    );
    const updated = await this.prisma.$transaction(async (tx) => {
      await lockDailySessionFlightRows(tx, [reservation.dailySessionFlightId]);
      await lockCounterReservationRows(tx, [id]);
      const persisted = await tx.counterReservation.findUnique({
        where: { id },
      });
      if (
        !persisted ||
        !(
          [
            CounterReservationStatus.SCHEDULED,
            CounterReservationStatus.ACTIVE,
          ] as CounterReservationStatus[]
        ).includes(persisted.status)
      ) {
        throw new ConflictException("Counter reservation is already finalized");
      }
      return tx.counterReservation.update({
        where: { id },
        data: { status },
        include: reservationInclude,
      });
    });
    await this.audit?.record({ user, action: status === CounterReservationStatus.CANCELLED
      ? 'CANCEL_COUNTER_RESERVATION' : 'RELEASE_COUNTER_RESERVATION', entityType: 'CounterReservation',
      entityId: updated.id, metadata: { dailySessionFlightId: updated.dailySessionFlightId,
        previousStatus: reservation.status, nextStatus: status } });
    this.publish(status === CounterReservationStatus.CANCELLED ? REALTIME_EVENTS.RESERVATION_RELEASED : REALTIME_EVENTS.RESERVATION_CREATED, updated);
    return updated;
  }

  private publish(event: typeof REALTIME_EVENTS.RESERVATION_CREATED | typeof REALTIME_EVENTS.RESERVATION_RELEASED,
    reservation: { id: string; companyId: string; dailySessionFlightId: string; dailyCompanySessionId: string;
      movementCategoryId: string; status: CounterReservationStatus; updatedAt: Date } | undefined) {
    if (!reservation) return;
    this.realtime?.emitScoped(event, { resourceId: reservation.id, dailySessionFlightId: reservation.dailySessionFlightId,
      dailyCompanySessionId: reservation.dailyCompanySessionId, companyId: reservation.companyId,
      movementCategoryId: reservation.movementCategoryId, status: reservation.status,
      updatedAt: reservation.updatedAt.toISOString() }, { companyId: reservation.companyId,
      movementCategoryId: reservation.movementCategoryId, admins: true });
  }

  private async assertCanReadFlightReservations(
    item: AuthorizationFlight,
    user: AuthUser,
  ) {
    if (user.role === Role.COMPANY_USER) {
      if (!user.companyId || item.companyId !== user.companyId) {
        throw new ForbiddenException("Access denied");
      }
      return;
    }
    if (
      user.role === Role.MOVEMENT_SUPERVISOR &&
      !(await this.canSupervisorReadFlight(item, user.id))
    ) {
      throw new ForbiddenException("Access denied");
    }
  }

  private async canSupervisorReadFlight(
    item: AuthorizationFlight,
    userId: string,
  ) {
    if (item.dailyCompanySession.dailyDuty.movementSupervisorId === userId)
      return true;
    if (
      !item.isCarryOver ||
      (item.handoverStatus !== HandoverStatus.ACCEPTED &&
        item.handoverStatus !== HandoverStatus.COMPLETED) ||
      !item.carriedToDailyDutyId
    ) {
      return false;
    }
    return (
      item.carriedToDailyDutyId ===
      (await this.getSupervisorActiveDutyId(userId))
    );
  }

  private async buildReadScope(
    user: AuthUser,
  ): Promise<Prisma.CounterReservationWhereInput | undefined> {
    if (user.role !== Role.MOVEMENT_SUPERVISOR) return undefined;
    const activeDutyId = await this.getSupervisorActiveDutyId(user.id);
    return {
      OR: [
        {
          dailySessionFlight: {
            dailyCompanySession: {
              dailyDuty: { movementSupervisorId: user.id },
            },
          },
        },
        ...(activeDutyId
          ? [
              {
                dailySessionFlight: {
                  isCarryOver: true,
                  handoverStatus: {
                    in: [HandoverStatus.ACCEPTED, HandoverStatus.COMPLETED],
                  },
                  carriedToDailyDutyId: activeDutyId,
                },
              } satisfies Prisma.CounterReservationWhereInput,
            ]
          : []),
      ],
    };
  }

  private async getSessionFlightForModification(
    sessionFlightId: string,
    user: AuthUser,
  ) {
    if (user.role !== Role.MOVEMENT_SUPERVISOR) {
      return this.access.assertCanModifySessionFlight(sessionFlightId, user);
    }
    const item = await this.prisma.dailySessionFlight.findUnique({
      where: { id: sessionFlightId },
      include: authorizationFlightInclude,
    });
    if (!item) throw new NotFoundException("Session flight not found");
    if (item.isCarryOver) {
      await this.assertCanModifyCarryOverFlight(item, user.id);
    } else {
      this.assertCanModifyNormalFlight(item, user.id);
    }
    return item;
  }

  private assertCanModifyNormalFlight(
    item: AuthorizationFlight,
    userId: string,
  ) {
    const duty = item.dailyCompanySession.dailyDuty;
    if (
      duty.movementSupervisorId !== userId ||
      duty.status !== DailyDutyStatus.OPEN ||
      duty.expiresAt <= new Date()
    ) {
      throw new ForbiddenException("Access denied");
    }
  }

  private async assertCanModifyCarryOverFlight(
    item: AuthorizationFlight,
    userId: string,
  ) {
    if (
      item.status !== DailySessionFlightStatus.CARRY_OVER ||
      item.handoverStatus !== HandoverStatus.ACCEPTED ||
      !item.carriedToDailyDutyId ||
      item.carriedToDailyDutyId !==
        (await this.getSupervisorActiveDutyId(userId))
    ) {
      throw new ForbiddenException("Access denied");
    }
  }

  private async getSupervisorActiveDutyId(userId: string) {
    const duty = await this.prisma.dailyDuty.findFirst({
      where: {
        movementSupervisorId: userId,
        status: DailyDutyStatus.OPEN,
        expiresAt: { gt: new Date() },
      },
      select: { id: true },
      orderBy: { activatedAt: "desc" },
    });
    return duty?.id;
  }
}
