import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  CounterReservationStatus,
  DailyFlightPreCheckStatus,
  DailySessionFlightStatus,
  Prisma,
  Role,
} from '@prisma/client';
import { AuditService } from '../../audit/audit.service';
import { lockDailySessionFlightRows } from '../../common/database/daily-session-flight-lock';
import {
  lockCounterReservationRows,
  lockDailyFlightPreCheckRows,
} from '../../common/database/precheck-lock';
import { AuthUser } from '../../common/types/auth-user.type';
import { PrismaService } from '../../prisma/prisma.service';
import { assertDailySessionFlightTransitionAllowed } from '../daily-session-flight-status-machine';
import { mapDailyFlightOperationStartResponse } from './daily-flight-operation-response.mapper';

const reservationSetConflictMessage =
  'Operation cannot start because the Counter Reservation set no longer matches the submitted PreCheck.';

@Injectable()
export class DailyFlightOperationsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  start(sessionFlightId: string, user: AuthUser) {
    return this.prisma.$transaction(async (tx) => {
      const lockedFlights = await lockDailySessionFlightRows(tx, [sessionFlightId]);
      if (!lockedFlights.length) throw new NotFoundException('Session flight not found');

      const flight = await tx.dailySessionFlight.findUnique({
        where: { id: sessionFlightId },
        select: { status: true, companyId: true },
      });
      if (!flight) throw new NotFoundException('Session flight not found');
      this.assertCanMutate(flight.companyId, user);

      const preCheckCandidate = await tx.dailyFlightPreCheck.findUnique({
        where: { dailySessionFlightId: sessionFlightId },
        select: { id: true },
      });
      if (!preCheckCandidate) {
        throw new ConflictException('A submitted PreCheck is required to start Operation.');
      }
      await lockDailyFlightPreCheckRows(tx, [preCheckCandidate.id]);
      const preCheck = await tx.dailyFlightPreCheck.findUnique({
        where: { id: preCheckCandidate.id },
        select: {
          status: true,
          itemResults: {
            select: { counterReservationId: true },
            orderBy: { id: 'asc' },
          },
        },
      });
      if (!preCheck || preCheck.status !== DailyFlightPreCheckStatus.SUBMITTED) {
        throw new ConflictException('A submitted PreCheck is required to start Operation.');
      }

      const reservationCandidates = await tx.counterReservation.findMany({
        where: { dailySessionFlightId: sessionFlightId },
        select: { id: true },
        orderBy: { id: 'asc' },
      });
      await lockCounterReservationRows(
        tx,
        reservationCandidates.map(({ id }) => id),
      );
      const reservations = await tx.counterReservation.findMany({
        where: {
          dailySessionFlightId: sessionFlightId,
          id: { in: reservationCandidates.map(({ id }) => id) },
        },
        select: { id: true, status: true },
        orderBy: { id: 'asc' },
      });

      const snapshotIds = preCheck.itemResults.map(({ counterReservationId }) => counterReservationId);
      if (snapshotIds.some((id) => id === null)) {
        throw new ConflictException(reservationSetConflictMessage);
      }
      const snapshotReservationIds = new Set(
        snapshotIds.filter((id): id is string => id !== null),
      );
      const operationalReservations = reservations.filter(
        ({ id, status }) =>
          snapshotReservationIds.has(id) ||
          status === CounterReservationStatus.SCHEDULED ||
          status === CounterReservationStatus.ACTIVE,
      );
      const operationalReservationIds = new Set(
        operationalReservations.map(({ id }) => id),
      );
      if (
        !snapshotReservationIds.size ||
        snapshotReservationIds.size !== operationalReservationIds.size ||
        [...snapshotReservationIds].some((id) => !operationalReservationIds.has(id))
      ) {
        throw new ConflictException(reservationSetConflictMessage);
      }

      if (flight.status === DailySessionFlightStatus.OPERATION) {
        if (
          operationalReservations.some(
            ({ status }) => status !== CounterReservationStatus.ACTIVE,
          )
        ) {
          throw new ConflictException('Operation is in an inconsistent Reservation state.');
        }
        return mapDailyFlightOperationStartResponse({
          flightStatus: flight.status,
          preCheckStatus: preCheck.status,
          reservationStatuses: operationalReservations.map(({ status }) => status),
        });
      }

      if (flight.status !== DailySessionFlightStatus.PRECHECK_DONE) {
        throw new ConflictException('Flight is not ready to start Operation.');
      }
      if (
        operationalReservations.some(
          ({ status }) => status !== CounterReservationStatus.SCHEDULED,
        )
      ) {
        throw new ConflictException('Counter Reservations are not ready for Operation.');
      }

      assertDailySessionFlightTransitionAllowed(
        flight.status,
        DailySessionFlightStatus.OPERATION,
      );
      const activated = await tx.counterReservation.updateMany({
        where: {
          dailySessionFlightId: sessionFlightId,
          id: { in: [...snapshotReservationIds] },
          status: CounterReservationStatus.SCHEDULED,
        },
        data: { status: CounterReservationStatus.ACTIVE },
      });
      if (activated.count !== snapshotReservationIds.size) {
        throw new ConflictException('Counter Reservations changed concurrently.');
      }
      await tx.dailySessionFlight.update({
        where: { id: sessionFlightId },
        data: { status: DailySessionFlightStatus.OPERATION },
      });
      await this.audit.record(
        {
          user,
          action: 'START_DAILY_FLIGHT_OPERATION',
          entityType: 'DailySessionFlight',
          entityId: sessionFlightId,
          metadata: {
            previousStatus: DailySessionFlightStatus.PRECHECK_DONE,
            nextStatus: DailySessionFlightStatus.OPERATION,
            activatedReservations: activated.count,
            submittedPreCheck: true,
          },
        },
        tx,
      );
      return mapDailyFlightOperationStartResponse({
        flightStatus: DailySessionFlightStatus.OPERATION,
        preCheckStatus: preCheck.status,
        reservationStatuses: operationalReservations.map(
          () => CounterReservationStatus.ACTIVE,
        ),
      });
    });
  }

  private assertCanMutate(companyId: string, user: AuthUser) {
    if (user.role === Role.COMPANY_USER) {
      if (!user.companyId || user.companyId !== companyId) {
        throw new ForbiddenException('Resource belongs to another company');
      }
      return;
    }
    if (user.role !== Role.SUPER_ADMIN) {
      throw new ForbiddenException('Only authorized Company users can start Operation.');
    }
  }
}
