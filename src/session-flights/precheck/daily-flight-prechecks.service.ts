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
  DailyFlightCheckResult,
  DailyFlightPreCheckStatus,
  DailySessionFlightStatus,
  HandoverStatus,
  Prisma,
  Role,
} from '@prisma/client';
import { AuditService } from '../../audit/audit.service';
import { lockDailySessionFlightRows } from '../../common/database/daily-session-flight-lock';
import {
  lockCounterReservationRows,
  lockDailyFlightPreCheckItemRows,
  lockDailyFlightPreCheckRows,
} from '../../common/database/precheck-lock';
import { AuthUser } from '../../common/types/auth-user.type';
import { PrismaService } from '../../prisma/prisma.service';
import { NotificationsGateway, REALTIME_EVENTS } from '../../notifications/notifications.gateway';
import { assertDailySessionFlightTransitionAllowed } from '../daily-session-flight-status-machine';
import {
  mapDailyFlightPreCheckResponse,
  PreCheckResponseRecord,
} from './daily-flight-precheck-response.mapper';
import { SavePreCheckResultsDto } from './dto/save-precheck-results.dto';

const eligibleReservationStatuses = [CounterReservationStatus.SCHEDULED] as const;
const preCheckResponseInclude = {
  startedBy: { select: { id: true, fullName: true } },
  submittedBy: { select: { id: true, fullName: true } },
  itemResults: {
    orderBy: [
      { counterCodeSnapshot: 'asc' },
      { checkItemCategorySnapshot: 'asc' },
      { checkItemOrderSnapshot: 'asc' },
      { checkItemNameSnapshot: 'asc' },
    ],
  },
} satisfies Prisma.DailyFlightPreCheckInclude;

@Injectable()
export class DailyFlightPreChecksService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    @Optional() private readonly realtime?: NotificationsGateway,
  ) {}

  async start(sessionFlightId: string, user: AuthUser) {
    const outcome = await this.prisma.$transaction(async (tx) => {
      await this.lockFlight(tx, sessionFlightId);
      const flight = await this.getFlight(tx, sessionFlightId);
      this.assertCanMutate(flight.companyId, user);

      const existing = await tx.dailyFlightPreCheck.findUnique({
        where: { dailySessionFlightId: sessionFlightId },
        include: preCheckResponseInclude,
      });
      if (existing) {
        if (
          existing.status === DailyFlightPreCheckStatus.IN_PROGRESS &&
          flight.status === DailySessionFlightStatus.PRECHECK_PENDING
        ) {
          return { response: mapDailyFlightPreCheckResponse(existing), created: false };
        }
        if (existing.status === DailyFlightPreCheckStatus.SUBMITTED) {
          throw new ConflictException('PreCheck has already been submitted.');
        }
        throw new ConflictException('PreCheck already exists in an incompatible state.');
      }
      if (flight.status !== DailySessionFlightStatus.SCHEDULED) {
        throw new ConflictException('PreCheck can only start for a scheduled Flight.');
      }

      const reservationCandidates = await tx.counterReservation.findMany({
        where: {
          dailySessionFlightId: sessionFlightId,
          status: { in: [...eligibleReservationStatuses] },
        },
        select: { id: true },
      });
      await lockCounterReservationRows(
        tx,
        reservationCandidates.map(({ id }) => id),
      );
      const reservations = await tx.counterReservation.findMany({
        where: {
          id: { in: reservationCandidates.map(({ id }) => id) },
          dailySessionFlightId: sessionFlightId,
          status: { in: [...eligibleReservationStatuses] },
        },
        include: { counter: true },
        orderBy: [{ counter: { code: 'asc' } }, { createdAt: 'asc' }],
      });
      if (!reservations.length) {
        throw new BadRequestException('No eligible Counter Reservations exist for this Flight.');
      }

      const checkItems = await tx.checkItem.findMany({
        where: { isActive: true },
        orderBy: [{ category: 'asc' }, { order: 'asc' }, { name: 'asc' }],
      });
      if (!checkItems.length) {
        throw new BadRequestException('No applicable active Check Items exist.');
      }

      assertDailySessionFlightTransitionAllowed(
        flight.status,
        DailySessionFlightStatus.PRECHECK_PENDING,
      );
      const created = await tx.dailyFlightPreCheck.create({
        data: {
          dailySessionFlightId: sessionFlightId,
          startedById: user.id,
          itemResults: {
            create: reservations.flatMap((reservation) =>
              checkItems.map((checkItem) => ({
                counterReservationId: reservation.id,
                checkItemId: checkItem.id,
                counterCodeSnapshot: reservation.counter.code,
                counterNameSnapshot: reservation.counter.name,
                checkItemNameSnapshot: checkItem.name,
                checkItemDescriptionSnapshot: checkItem.description,
                checkItemCategorySnapshot: checkItem.category,
                checkItemRequiredSnapshot: checkItem.isRequired,
                checkItemAllowsNotApplicableSnapshot: checkItem.allowsNotApplicable,
                checkItemOrderSnapshot: checkItem.order,
              })),
            ),
          },
        },
        include: preCheckResponseInclude,
      });
      await tx.dailySessionFlight.update({
        where: { id: sessionFlightId },
        data: { status: DailySessionFlightStatus.PRECHECK_PENDING },
      });
      return { response: mapDailyFlightPreCheckResponse(created), created: true };
    });

    if (outcome.created) {
      await this.audit.record({
        user,
        action: 'START_DAILY_FLIGHT_PRECHECK',
        entityType: 'DailySessionFlight',
        entityId: sessionFlightId,
        metadata: {
          counters: outcome.response.counters.length,
          items: outcome.response.counters.reduce(
            (total, counter) => total + counter.items.length,
            0,
          ),
          previousStatus: DailySessionFlightStatus.SCHEDULED,
          nextStatus: DailySessionFlightStatus.PRECHECK_PENDING,
        },
      });
      await this.publish(REALTIME_EVENTS.PRECHECK_STARTED, sessionFlightId);
    }
    return outcome.response;
  }

  async get(sessionFlightId: string, user: AuthUser) {
    const flight = await this.prisma.dailySessionFlight.findUnique({
      where: { id: sessionFlightId },
      include: { dailyCompanySession: { include: { dailyDuty: true } } },
    });
    if (!flight) throw new NotFoundException('Session flight not found');
    await this.assertCanRead(flight, user);
    const preCheck = await this.prisma.dailyFlightPreCheck.findUnique({
      where: { dailySessionFlightId: sessionFlightId },
      include: preCheckResponseInclude,
    });
    if (!preCheck) throw new NotFoundException('PreCheck has not started.');
    return mapDailyFlightPreCheckResponse(preCheck);
  }

  async saveResults(sessionFlightId: string, dto: SavePreCheckResultsDto, user: AuthUser) {
    const ids = dto.items.map(({ itemResultId }) => itemResultId);
    if (new Set(ids).size !== ids.length) {
      throw new BadRequestException('Duplicate PreCheck item result IDs are not allowed.');
    }

    const response = await this.prisma.$transaction(async (tx) => {
      await this.lockFlight(tx, sessionFlightId);
      const flight = await this.getFlight(tx, sessionFlightId);
      this.assertCanMutate(flight.companyId, user);
      this.assertInProgressFlight(flight.status);
      const preCheck = await this.getAndLockPreCheck(tx, sessionFlightId);
      this.assertInProgressPreCheck(preCheck.status);
      await lockDailyFlightPreCheckItemRows(tx, ids);
      const matchingCount = await tx.dailyFlightPreCheckItemResult.count({
        where: { id: { in: ids }, preCheckId: preCheck.id },
      });
      if (matchingCount !== ids.length) {
        throw new BadRequestException('A result item does not belong to this Flight PreCheck.');
      }

      for (const item of dto.items) {
        const current = await tx.dailyFlightPreCheckItemResult.findFirstOrThrow({
          where: { id: item.itemResultId, preCheckId: preCheck.id },
          include: { counterReservation: { select: { counterId: true } } },
        });
        const note = item.note?.trim() || null;
        if (item.result === DailyFlightCheckResult.FAIL && (!note || note.length < 3))
          throw new BadRequestException('FAIL requires a meaningful note.');
        if (item.result === DailyFlightCheckResult.NOT_APPLICABLE && !current.checkItemAllowsNotApplicableSnapshot)
          throw new BadRequestException('NOT_APPLICABLE is not permitted for this Check Item.');
        await tx.dailyFlightPreCheckItemResult.update({
          where: { id: item.itemResultId },
          data: {
            result: item.result,
            note: item.note === undefined ? undefined : note,
          },
        });
        if (item.result === DailyFlightCheckResult.FAIL && current.counterReservation) {
          await tx.dailyFlightOperationalIssue.upsert({ where: { preCheckItemResultId: current.id },
            create: { dailySessionFlightId: sessionFlightId, counterId: current.counterReservation.counterId,
              checkItemId: current.checkItemId, preCheckItemResultId: current.id,
              counterCodeSnapshot: current.counterCodeSnapshot, checkItemNameSnapshot: current.checkItemNameSnapshot,
              checkItemDescriptionSnapshot: current.checkItemDescriptionSnapshot, result: item.result,
              failureNote: note!, reportedById: user.id }, update: { failureNote: note!, result: item.result } });
          await this.audit.record({ user, action: 'RECORD_DAILY_FLIGHT_PRECHECK_FAILURE', entityType: 'DailySessionFlight',
            entityId: sessionFlightId, metadata: { itemResultId: current.id, counterId: current.counterReservation.counterId } }, tx);
        }
      }
      return this.loadResponse(tx, preCheck.id);
    });

    await this.audit.record({
      user,
      action: 'SAVE_DAILY_FLIGHT_PRECHECK_RESULTS',
      entityType: 'DailySessionFlight',
      entityId: sessionFlightId,
      metadata: { updatedItems: dto.items.length },
    });
    await this.publish(REALTIME_EVENTS.PRECHECK_UPDATED, sessionFlightId);
    return response;
  }

  async submit(sessionFlightId: string, user: AuthUser) {
    const response = await this.prisma.$transaction(async (tx) => {
      await this.lockFlight(tx, sessionFlightId);
      const flight = await this.getFlight(tx, sessionFlightId);
      this.assertCanMutate(flight.companyId, user);
      this.assertInProgressFlight(flight.status);
      const preCheck = await this.getAndLockPreCheck(tx, sessionFlightId);
      this.assertInProgressPreCheck(preCheck.status);
      const items = await tx.dailyFlightPreCheckItemResult.findMany({
        where: { preCheckId: preCheck.id },
        orderBy: { id: 'asc' },
      });
      await lockDailyFlightPreCheckItemRows(
        tx,
        items.map(({ id }) => id),
      );

      const reservationCandidates = await tx.counterReservation.findMany({
        where: {
          dailySessionFlightId: sessionFlightId,
          status: { in: [...eligibleReservationStatuses] },
        },
        select: { id: true },
        orderBy: { id: 'asc' },
      });
      await lockCounterReservationRows(
        tx,
        reservationCandidates.map(({ id }) => id),
      );
      const currentReservations = await tx.counterReservation.findMany({
        where: {
          id: { in: reservationCandidates.map(({ id }) => id) },
          dailySessionFlightId: sessionFlightId,
          status: { in: [...eligibleReservationStatuses] },
        },
        select: { id: true },
        orderBy: { id: 'asc' },
      });
      const snapshotReservationIds = new Set(
        items.map(({ counterReservationId }) => counterReservationId).filter((id): id is string => !!id),
      );
      const currentReservationIds = new Set(currentReservations.map(({ id }) => id));
      if (
        snapshotReservationIds.size !== currentReservationIds.size ||
        [...snapshotReservationIds].some((id) => !currentReservationIds.has(id))
      ) {
        throw new ConflictException('Counter Reservation set no longer matches the PreCheck snapshot.');
      }

      const unanswered = items.filter(({ result }) => result === null).length;
      if (unanswered) {
        throw new ConflictException(`PreCheck has ${unanswered} unanswered Check Items.`);
      }
      if (items.some((item) => item.result === DailyFlightCheckResult.FAIL && (item.note?.trim().length ?? 0) < 3))
        throw new ConflictException('Every failed PreCheck item requires a meaningful note.');
      if (items.some((item) => item.result === DailyFlightCheckResult.NOT_APPLICABLE && !item.checkItemAllowsNotApplicableSnapshot))
        throw new ConflictException('NOT_APPLICABLE is not permitted for one or more Check Items.');
      const failed = items.filter(({ result }) => result === DailyFlightCheckResult.FAIL).length;
      if (failed) {
        throw new ConflictException('PreCheck cannot be submitted while failed Check Items remain.');
      }
      assertDailySessionFlightTransitionAllowed(
        flight.status,
        DailySessionFlightStatus.PRECHECK_DONE,
      );
      const submittedAt = new Date();
      await tx.dailyFlightPreCheck.update({
        where: { id: preCheck.id },
        data: {
          status: DailyFlightPreCheckStatus.SUBMITTED,
          submittedById: user.id,
          submittedAt,
        },
      });
      await tx.dailySessionFlight.update({
        where: { id: sessionFlightId },
        data: { status: DailySessionFlightStatus.PRECHECK_DONE },
      });
      return this.loadResponse(tx, preCheck.id);
    });

    const counts = { PASS: 0, FAIL: 0, NOT_APPLICABLE: 0 };
    for (const counter of response.counters) {
      for (const item of counter.items) {
        if (item.result) counts[item.result] += 1;
      }
    }
    await this.audit.record({
      user,
      action: 'SUBMIT_DAILY_FLIGHT_PRECHECK',
      entityType: 'DailySessionFlight',
      entityId: sessionFlightId,
      metadata: {
        ...counts,
        previousStatus: DailySessionFlightStatus.PRECHECK_PENDING,
        nextStatus: DailySessionFlightStatus.PRECHECK_DONE,
      },
    });
    await this.publish(REALTIME_EVENTS.PRECHECK_SUBMITTED, sessionFlightId);
    return response;
  }

  private async publish(
    event: typeof REALTIME_EVENTS.PRECHECK_STARTED | typeof REALTIME_EVENTS.PRECHECK_UPDATED |
      typeof REALTIME_EVENTS.PRECHECK_SUBMITTED,
    sessionFlightId: string,
  ) {
    if (!this.realtime) return;
    const flight = await this.prisma.dailySessionFlight.findUnique({
      where: { id: sessionFlightId },
      select: {
        companyId: true,
        movementCategoryId: true,
        dailyCompanySessionId: true,
        status: true,
        updatedAt: true,
        dailyCompanySession: { select: { dailyDutyId: true } },
      },
    });
    if (!flight) return;
    this.realtime.emitScoped(event, {
      resourceId: sessionFlightId,
      dailySessionFlightId: sessionFlightId,
      dailyCompanySessionId: flight.dailyCompanySessionId,
      dailyDutyId: flight.dailyCompanySession.dailyDutyId,
      companyId: flight.companyId,
      movementCategoryId: flight.movementCategoryId,
      status: flight.status,
      updatedAt: flight.updatedAt.toISOString(),
    }, {
      companyId: flight.companyId,
      dailyDutyId: flight.dailyCompanySession.dailyDutyId,
      movementCategoryId: flight.movementCategoryId,
      admins: true,
    });
  }

  private async lockFlight(tx: Prisma.TransactionClient, id: string) {
    const locked = await lockDailySessionFlightRows(tx, [id]);
    if (!locked.length) throw new NotFoundException('Session flight not found');
  }

  private async getFlight(tx: Prisma.TransactionClient, id: string) {
    const flight = await tx.dailySessionFlight.findUnique({
      where: { id },
      include: { dailyCompanySession: { include: { dailyDuty: true } } },
    });
    if (!flight) throw new NotFoundException('Session flight not found');
    return flight;
  }

  private async getAndLockPreCheck(tx: Prisma.TransactionClient, sessionFlightId: string) {
    const preCheck = await tx.dailyFlightPreCheck.findUnique({
      where: { dailySessionFlightId: sessionFlightId },
    });
    if (!preCheck) throw new NotFoundException('PreCheck has not started.');
    await lockDailyFlightPreCheckRows(tx, [preCheck.id]);
    return tx.dailyFlightPreCheck.findUniqueOrThrow({ where: { id: preCheck.id } });
  }

  private assertCanMutate(companyId: string, user: AuthUser) {
    if (user.role === Role.COMPANY_USER) {
      if (!user.companyId || user.companyId !== companyId) {
        throw new ForbiddenException('Resource belongs to another company');
      }
      return;
    }
    if (user.role !== Role.SUPER_ADMIN) {
      throw new ForbiddenException('Only authorized Company users can perform PreCheck.');
    }
  }

  private async assertCanRead(
    flight: {
      companyId: string;
      isCarryOver: boolean;
      handoverStatus: HandoverStatus;
      carriedToDailyDutyId: string | null;
      dailyCompanySession: { dailyDuty: { movementSupervisorId: string } };
    },
    user: AuthUser,
  ) {
    if (user.role === Role.COMPANY_USER && user.companyId !== flight.companyId) {
      throw new ForbiddenException('Resource belongs to another company');
    }
    if (
      user.role === Role.MOVEMENT_SUPERVISOR &&
      flight.dailyCompanySession.dailyDuty.movementSupervisorId !== user.id
    ) {
      const activeDuty = await this.prisma.dailyDuty.findFirst({
        where: { movementSupervisorId: user.id, status: 'OPEN', expiresAt: { gt: new Date() } },
        select: { id: true },
        orderBy: { activatedAt: 'desc' },
      });
      if (
        !flight.isCarryOver ||
        !activeDuty ||
        flight.carriedToDailyDutyId !== activeDuty.id ||
        (flight.handoverStatus !== HandoverStatus.ACCEPTED &&
          flight.handoverStatus !== HandoverStatus.COMPLETED)
      ) {
        throw new ForbiddenException('Access denied');
      }
    }
  }

  private assertInProgressFlight(status: DailySessionFlightStatus) {
    if (status !== DailySessionFlightStatus.PRECHECK_PENDING) {
      throw new ConflictException('Flight is not pending PreCheck.');
    }
  }

  private assertInProgressPreCheck(status: DailyFlightPreCheckStatus) {
    if (status !== DailyFlightPreCheckStatus.IN_PROGRESS) {
      throw new ConflictException('PreCheck has already been submitted.');
    }
  }

  private async loadResponse(tx: Prisma.TransactionClient, preCheckId: string) {
    const preCheck = await tx.dailyFlightPreCheck.findUniqueOrThrow({
      where: { id: preCheckId },
      include: preCheckResponseInclude,
    });
    return mapDailyFlightPreCheckResponse(preCheck satisfies PreCheckResponseRecord);
  }
}
