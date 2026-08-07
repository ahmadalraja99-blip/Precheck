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
  DailyFlightCheckResult,
  DailyFlightOutCheckStatus,
  DailyFlightOutCheckSubmissionStatus,
  DailySessionFlightStatus,
  HandoverStatus,
  Prisma,
  Role,
} from "@prisma/client";
import { AuditService } from "../../audit/audit.service";
import { lockDailySessionFlightRows } from "../../common/database/daily-session-flight-lock";
import {
  lockDailyFlightOutCheckItemRows,
  lockDailyFlightOutCheckRows,
} from "../../common/database/outcheck-lock";
import { lockCounterReservationRows } from "../../common/database/precheck-lock";
import { lockDailyFlightOutCheckSubmissionRows } from "../../common/database/outcheck-submission-lock";
import { AuthUser } from "../../common/types/auth-user.type";
import { PrismaService } from "../../prisma/prisma.service";
import { NotificationsGateway, REALTIME_EVENTS } from "../../notifications/notifications.gateway";
import { assertDailySessionFlightTransitionAllowed } from "../daily-session-flight-status-machine";
import {
  mapDailyFlightOutCheckResponse,
  OutCheckResponseRecord,
} from "./daily-flight-outcheck-response.mapper";
import { SaveOutCheckResultsDto } from "./dto/save-outcheck-results.dto";
import { mapDailyFlightOutCheckSubmissionSummary } from "./submissions/daily-flight-outcheck-submission-response.mapper";

const snapshotConflictMessage =
  "OutCheck cannot be submitted because the Counter Reservation set no longer matches the OutCheck snapshot.";
const outCheckResponseInclude = {
  startedBy: { select: { id: true, fullName: true } },
  submittedBy: { select: { id: true, fullName: true } },
  itemResults: {
    orderBy: [
      { counterCodeSnapshot: "asc" },
      { checkItemCategorySnapshot: "asc" },
      { checkItemOrderSnapshot: "asc" },
      { checkItemNameSnapshot: "asc" },
    ],
  },
} satisfies Prisma.DailyFlightOutCheckInclude;

@Injectable()
export class DailyFlightOutChecksService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    @Optional() private readonly realtime?: NotificationsGateway,
  ) {}

  async start(sessionFlightId: string, user: AuthUser) {
    const response = await this.prisma.$transaction(async (tx) => {
      await this.lockFlight(tx, sessionFlightId);
      const flight = await this.getFlight(tx, sessionFlightId);
      this.assertCanMutate(flight.companyId, user);

      const existingCandidate = await tx.dailyFlightOutCheck.findUnique({
        where: { dailySessionFlightId: sessionFlightId },
        select: { id: true },
      });
      if (existingCandidate) {
        await lockDailyFlightOutCheckRows(tx, [existingCandidate.id]);
        const existing = await tx.dailyFlightOutCheck.findUnique({
          where: { id: existingCandidate.id },
          include: outCheckResponseInclude,
        });
        if (
          existing?.status === DailyFlightOutCheckStatus.IN_PROGRESS &&
          flight.status === DailySessionFlightStatus.OUTCHECK_PENDING
        ) {
          return mapDailyFlightOutCheckResponse(existing);
        }
        if (existing?.status === DailyFlightOutCheckStatus.SUBMITTED) {
          throw new ConflictException("OutCheck has already been submitted.");
        }
        throw new ConflictException(
          "OutCheck already exists in an incompatible state.",
        );
      }
      if (flight.status !== DailySessionFlightStatus.OPERATION) {
        throw new ConflictException("Flight is not in Operation.");
      }

      const reservations = await this.loadAndLockReservations(
        tx,
        sessionFlightId,
      );
      if (!reservations.length) {
        throw new BadRequestException(
          "No ACTIVE Counter Reservations exist for this Flight.",
        );
      }
      if (
        reservations.some(
          ({ status }) => status !== CounterReservationStatus.ACTIVE,
        )
      ) {
        throw new ConflictException(
          "All operational Counter Reservations must be ACTIVE.",
        );
      }
      const checkItems = await tx.checkItem.findMany({
        where: { isActive: true },
        orderBy: [{ category: "asc" }, { order: "asc" }, { name: "asc" }],
      });
      if (!checkItems.length) {
        throw new BadRequestException(
          "No applicable active Check Items exist.",
        );
      }

      assertDailySessionFlightTransitionAllowed(
        flight.status,
        DailySessionFlightStatus.OUTCHECK_PENDING,
      );
      const created = await tx.dailyFlightOutCheck.create({
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
        include: outCheckResponseInclude,
      });
      await tx.dailySessionFlight.update({
        where: { id: sessionFlightId },
        data: { status: DailySessionFlightStatus.OUTCHECK_PENDING },
      });
      await this.audit.record(
        {
          user,
          action: "START_DAILY_FLIGHT_OUTCHECK",
          entityType: "DailySessionFlight",
          entityId: sessionFlightId,
          metadata: {
            previousStatus: DailySessionFlightStatus.OPERATION,
            nextStatus: DailySessionFlightStatus.OUTCHECK_PENDING,
            snapshotCounters: reservations.length,
            snapshotItems: reservations.length * checkItems.length,
          },
        },
        tx,
      );
      return mapDailyFlightOutCheckResponse(created);
    });
    await this.publish(REALTIME_EVENTS.OUTCHECK_STARTED, sessionFlightId);
    return response;
  }

  async get(sessionFlightId: string, user: AuthUser) {
    const existing = await this.findForRead(sessionFlightId, user);
    const outCheck = await this.prisma.dailyFlightOutCheck.findUnique({
      where: { id: existing.id },
      include: outCheckResponseInclude,
    });
    if (!outCheck) throw new NotFoundException("OutCheck has not started.");
    return mapDailyFlightOutCheckResponse(outCheck);
  }

  async findForRead(sessionFlightId: string, user: AuthUser) {
    const flight = await this.prisma.dailySessionFlight.findUnique({
      where: { id: sessionFlightId },
      include: { dailyCompanySession: { include: { dailyDuty: true } } },
    });
    if (!flight) throw new NotFoundException("Session flight not found");
    await this.assertCanRead(flight, user);
    const outCheck = await this.prisma.dailyFlightOutCheck.findUnique({
      where: { dailySessionFlightId: sessionFlightId },
      select: { id: true },
    });
    if (!outCheck) throw new NotFoundException("OutCheck has not started.");
    return outCheck;
  }

  async saveResults(
    sessionFlightId: string,
    dto: SaveOutCheckResultsDto,
    user: AuthUser,
  ) {
    const ids = dto.items.map(({ itemResultId }) => itemResultId);
    if (new Set(ids).size !== ids.length) {
      throw new BadRequestException(
        "Duplicate OutCheck item result IDs are not allowed.",
      );
    }
    const response = await this.prisma.$transaction(async (tx) => {
      await this.lockFlight(tx, sessionFlightId);
      const flight = await this.getFlight(tx, sessionFlightId);
      this.assertCanMutate(flight.companyId, user);
      this.assertPendingFlight(flight.status);
      const outCheck = await this.getAndLockOutCheck(tx, sessionFlightId);
      this.assertInProgress(outCheck.status);
      await lockDailyFlightOutCheckItemRows(tx, ids);
      const matchingCount = await tx.dailyFlightOutCheckItemResult.count({
        where: { id: { in: ids }, outCheckId: outCheck.id },
      });
      if (matchingCount !== ids.length) {
        throw new BadRequestException(
          "A result item does not belong to this Flight OutCheck.",
        );
      }
      for (const item of dto.items) {
        const current = await tx.dailyFlightOutCheckItemResult.findFirstOrThrow({
          where: { id: item.itemResultId, outCheckId: outCheck.id },
        });
        const note = item.note?.trim() || null;
        if (item.result === DailyFlightCheckResult.FAIL && (!note || note.length < 3))
          throw new BadRequestException("FAIL requires a meaningful note.");
        if (item.result === DailyFlightCheckResult.NOT_APPLICABLE && !current.checkItemAllowsNotApplicableSnapshot)
          throw new BadRequestException("NOT_APPLICABLE is not permitted for this Check Item.");
        await tx.dailyFlightOutCheckItemResult.update({
          where: { id: item.itemResultId },
          data: {
            result: item.result,
            note: item.note === undefined ? undefined : note,
          },
        });
      }
      const response = await this.loadResponse(tx, outCheck.id);
      await this.audit.record(
        {
          user,
          action: "SAVE_DAILY_FLIGHT_OUTCHECK_RESULTS",
          entityType: "DailySessionFlight",
          entityId: sessionFlightId,
          metadata: {
            updatedItems: dto.items.length,
            passed: response.summary.passed,
            failed: response.summary.failed,
            notApplicable: response.summary.notApplicable,
          },
        },
        tx,
      );
      return response;
    });
    await this.publish(REALTIME_EVENTS.OUTCHECK_UPDATED, sessionFlightId);
    return response;
  }

  async submit(sessionFlightId: string, user: AuthUser) {
    try {
      const response = await this.prisma.$transaction(async (tx) => {
        await this.lockFlight(tx, sessionFlightId);
        const flight = await this.getFlight(tx, sessionFlightId);
        this.assertCanMutate(flight.companyId, user);
        this.assertPendingFlight(flight.status);
        const outCheck = await this.getAndLockOutCheck(tx, sessionFlightId);

        const submissionCandidates =
          await tx.dailyFlightOutCheckSubmission.findMany({
            where: { outCheckId: outCheck.id },
            select: { id: true },
            orderBy: { attemptNumber: "asc" },
          });
        await lockDailyFlightOutCheckSubmissionRows(
          tx,
          submissionCandidates.map(({ id }) => id),
        );
        const submissions = await tx.dailyFlightOutCheckSubmission.findMany({
          where: { outCheckId: outCheck.id },
          include: {
            submittedBy: { select: { id: true, fullName: true } },
            items: { orderBy: { sourceWorkingItemId: "asc" } },
          },
          orderBy: { attemptNumber: "asc" },
        });
        const pending = submissions.filter(
          ({ status }) =>
            status === DailyFlightOutCheckSubmissionStatus.PENDING_REVIEW,
        );

        const items = await tx.dailyFlightOutCheckItemResult.findMany({
          where: { outCheckId: outCheck.id },
          orderBy: { id: "asc" },
        });
        await lockDailyFlightOutCheckItemRows(
          tx,
          items.map(({ id }) => id),
        );
        const reservations = await this.loadAndLockReservations(
          tx,
          sessionFlightId,
        );
        this.assertReservationSnapshot(items, reservations);

        if (outCheck.status === DailyFlightOutCheckStatus.SUBMITTED) {
          if (pending.length !== 1) {
            throw new ConflictException(
              "Submitted OutCheck has an inconsistent pending attempt.",
            );
          }
          this.assertPendingSubmissionMatchesWorking(
            pending[0],
            outCheck,
            items,
          );
          const response = await this.loadResponse(tx, outCheck.id);
          return {
            ...response,
            submission: mapDailyFlightOutCheckSubmissionSummary(pending[0]),
          };
        }
        this.assertInProgress(outCheck.status);
        if (pending.length) {
          throw new ConflictException(
            "In-progress OutCheck already has a pending attempt.",
          );
        }

        const unanswered = items.filter(({ result }) => result === null).length;
        if (unanswered) {
          throw new ConflictException(
            `OutCheck has ${unanswered} unanswered Check Items.`,
          );
        }
        if (items.some((item) => item.result === DailyFlightCheckResult.FAIL && (item.note?.trim().length ?? 0) < 3))
          throw new ConflictException("Every failed OutCheck item requires a meaningful note.");
        if (items.some((item) => item.result === DailyFlightCheckResult.NOT_APPLICABLE && !item.checkItemAllowsNotApplicableSnapshot))
          throw new ConflictException("NOT_APPLICABLE is not permitted for one or more Check Items.");
        const counts = {
          total: items.length,
          passed: items.filter(
            ({ result }) => result === DailyFlightCheckResult.PASS,
          ).length,
          failed: items.filter(
            ({ result }) => result === DailyFlightCheckResult.FAIL,
          ).length,
          notApplicable: items.filter(
            ({ result }) => result === DailyFlightCheckResult.NOT_APPLICABLE,
          ).length,
        };
        const nextAttemptNumber =
          (submissions.length
            ? submissions[submissions.length - 1].attemptNumber
            : 0) + 1;
        const submittedAt = new Date();
        const submission = await tx.dailyFlightOutCheckSubmission.create({
          data: {
            outCheckId: outCheck.id,
            attemptNumber: nextAttemptNumber,
            submittedById: user.id,
            submittedAt,
            totalCount: counts.total,
            passCount: counts.passed,
            failCount: counts.failed,
            notApplicableCount: counts.notApplicable,
            items: {
              create: items.map((item) => {
                if (item.result === null) {
                  throw new ConflictException(
                    "OutCheck contains an unanswered Check Item.",
                  );
                }
                return {
                  sourceWorkingItemId: item.id,
                  counterCodeSnapshot: item.counterCodeSnapshot,
                  counterNameSnapshot: item.counterNameSnapshot,
                  checkItemNameSnapshot: item.checkItemNameSnapshot,
                  checkItemDescriptionSnapshot:
                    item.checkItemDescriptionSnapshot,
                  checkItemCategorySnapshot: item.checkItemCategorySnapshot,
                  checkItemRequiredSnapshot: item.checkItemRequiredSnapshot,
                  checkItemAllowsNotApplicableSnapshot: item.checkItemAllowsNotApplicableSnapshot,
                  checkItemOrderSnapshot: item.checkItemOrderSnapshot,
                  result: item.result,
                  note: item.note,
                };
              }),
            },
          },
          include: {
            submittedBy: { select: { id: true, fullName: true } },
          },
        });
        await tx.dailyFlightOutCheck.update({
          where: { id: outCheck.id },
          data: {
            status: DailyFlightOutCheckStatus.SUBMITTED,
            submittedById: user.id,
            submittedAt,
          },
        });
        const response = await this.loadResponse(tx, outCheck.id);
        await this.audit.record(
          {
            user,
            action: "CREATE_DAILY_FLIGHT_OUTCHECK_SUBMISSION",
            entityType: "DailySessionFlight",
            entityId: sessionFlightId,
            metadata: {
              attemptNumber: nextAttemptNumber,
              totalCount: counts.total,
              passCount: counts.passed,
              failCount: counts.failed,
              notApplicableCount: counts.notApplicable,
              previousStatus: DailyFlightOutCheckStatus.IN_PROGRESS,
              nextStatus: DailyFlightOutCheckStatus.SUBMITTED,
              flightStatus: DailySessionFlightStatus.OUTCHECK_PENDING,
            },
          },
          tx,
        );
        return {
          ...response,
          submission: mapDailyFlightOutCheckSubmissionSummary(submission),
        };
      });
      await this.publish(REALTIME_EVENTS.OUTCHECK_SUBMITTED, sessionFlightId);
      return response;
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === "P2002"
      ) {
        throw new ConflictException(
          "OutCheck submission changed concurrently.",
        );
      }
      throw error;
    }
  }

  private async publish(
    event: typeof REALTIME_EVENTS.OUTCHECK_STARTED | typeof REALTIME_EVENTS.OUTCHECK_UPDATED |
      typeof REALTIME_EVENTS.OUTCHECK_SUBMITTED,
    sessionFlightId: string,
  ) {
    if (!this.realtime) return;
    const flight = await this.prisma.dailySessionFlight.findUnique({ where: { id: sessionFlightId },
      select: { companyId: true, movementCategoryId: true, dailyCompanySessionId: true,
        status: true, updatedAt: true, dailyCompanySession: { select: { dailyDutyId: true } } } });
    if (!flight) return;
    this.realtime.emitScoped(event, { resourceId: sessionFlightId, dailySessionFlightId: sessionFlightId,
      dailyCompanySessionId: flight.dailyCompanySessionId, dailyDutyId: flight.dailyCompanySession.dailyDutyId,
      companyId: flight.companyId, movementCategoryId: flight.movementCategoryId,
      status: flight.status, updatedAt: flight.updatedAt.toISOString() },
    { companyId: flight.companyId, dailyDutyId: flight.dailyCompanySession.dailyDutyId,
      movementCategoryId: flight.movementCategoryId, admins: true });
  }

  private assertPendingSubmissionMatchesWorking(
    submission: {
      submittedById: string | null;
      submittedAt: Date | null;
      totalCount: number;
      passCount: number;
      failCount: number;
      notApplicableCount: number;
      items: Array<{
        sourceWorkingItemId: string | null;
        counterCodeSnapshot: string;
        counterNameSnapshot: string;
        checkItemNameSnapshot: string;
        checkItemDescriptionSnapshot: string | null;
        checkItemCategorySnapshot: string;
        checkItemRequiredSnapshot: boolean;
        checkItemOrderSnapshot: number;
        result: DailyFlightCheckResult;
        note: string | null;
      }>;
    },
    outCheck: {
      submittedById: string | null;
      submittedAt: Date | null;
    },
    workingItems: Array<{
      id: string;
      counterCodeSnapshot: string;
      counterNameSnapshot: string;
      checkItemNameSnapshot: string;
      checkItemDescriptionSnapshot: string | null;
      checkItemCategorySnapshot: string;
      checkItemRequiredSnapshot: boolean;
      checkItemOrderSnapshot: number;
      result: DailyFlightCheckResult | null;
      note: string | null;
    }>,
  ) {
    const immutableItems = new Map(
      submission.items.map((item) => [item.sourceWorkingItemId, item]),
    );
    const counts = {
      passed: submission.items.filter(
        ({ result }) => result === DailyFlightCheckResult.PASS,
      ).length,
      failed: submission.items.filter(
        ({ result }) => result === DailyFlightCheckResult.FAIL,
      ).length,
      notApplicable: submission.items.filter(
        ({ result }) => result === DailyFlightCheckResult.NOT_APPLICABLE,
      ).length,
    };
    const itemsMatch =
      immutableItems.size === workingItems.length &&
      workingItems.every((working) => {
        const immutable = immutableItems.get(working.id);
        return (
          immutable !== undefined &&
          working.result !== null &&
          immutable.counterCodeSnapshot === working.counterCodeSnapshot &&
          immutable.counterNameSnapshot === working.counterNameSnapshot &&
          immutable.checkItemNameSnapshot === working.checkItemNameSnapshot &&
          immutable.checkItemDescriptionSnapshot ===
            working.checkItemDescriptionSnapshot &&
          immutable.checkItemCategorySnapshot ===
            working.checkItemCategorySnapshot &&
          immutable.checkItemRequiredSnapshot ===
            working.checkItemRequiredSnapshot &&
          immutable.checkItemOrderSnapshot === working.checkItemOrderSnapshot &&
          immutable.result === working.result &&
          immutable.note === working.note
        );
      });
    if (
      !itemsMatch ||
      submission.totalCount !== submission.items.length ||
      submission.passCount !== counts.passed ||
      submission.failCount !== counts.failed ||
      submission.notApplicableCount !== counts.notApplicable ||
      counts.passed + counts.failed + counts.notApplicable !==
        submission.totalCount ||
      submission.submittedById !== outCheck.submittedById ||
      submission.submittedAt?.getTime() !== outCheck.submittedAt?.getTime()
    ) {
      throw new ConflictException(
        "Pending OutCheck submission evidence is inconsistent.",
      );
    }
  }

  private async lockFlight(tx: Prisma.TransactionClient, id: string) {
    const locked = await lockDailySessionFlightRows(tx, [id]);
    if (!locked.length) throw new NotFoundException("Session flight not found");
  }

  private async getFlight(tx: Prisma.TransactionClient, id: string) {
    const flight = await tx.dailySessionFlight.findUnique({
      where: { id },
      select: { status: true, companyId: true },
    });
    if (!flight) throw new NotFoundException("Session flight not found");
    return flight;
  }

  private async getAndLockOutCheck(
    tx: Prisma.TransactionClient,
    sessionFlightId: string,
  ) {
    const outCheck = await tx.dailyFlightOutCheck.findUnique({
      where: { dailySessionFlightId: sessionFlightId },
    });
    if (!outCheck) throw new NotFoundException("OutCheck has not started.");
    await lockDailyFlightOutCheckRows(tx, [outCheck.id]);
    return tx.dailyFlightOutCheck.findUniqueOrThrow({
      where: { id: outCheck.id },
    });
  }

  private async loadAndLockReservations(
    tx: Prisma.TransactionClient,
    sessionFlightId: string,
  ) {
    const candidates = await tx.counterReservation.findMany({
      where: { dailySessionFlightId: sessionFlightId },
      select: { id: true },
      orderBy: { id: "asc" },
    });
    await lockCounterReservationRows(
      tx,
      candidates.map(({ id }) => id),
    );
    return tx.counterReservation.findMany({
      where: {
        dailySessionFlightId: sessionFlightId,
        id: { in: candidates.map(({ id }) => id) },
      },
      select: {
        id: true,
        status: true,
        counter: { select: { code: true, name: true } },
      },
      orderBy: { id: "asc" },
    });
  }

  private assertReservationSnapshot(
    items: Array<{ counterReservationId: string | null }>,
    reservations: Array<{ id: string; status: CounterReservationStatus }>,
  ) {
    const snapshotIds = items.map(
      ({ counterReservationId }) => counterReservationId,
    );
    if (snapshotIds.some((id) => id === null)) {
      throw new ConflictException(snapshotConflictMessage);
    }
    const expected = new Set(
      snapshotIds.filter((id): id is string => id !== null),
    );
    const current = new Set(reservations.map(({ id }) => id));
    if (
      !expected.size ||
      expected.size !== current.size ||
      [...expected].some((id) => !current.has(id)) ||
      reservations.some(
        ({ status }) => status !== CounterReservationStatus.ACTIVE,
      )
    ) {
      throw new ConflictException(snapshotConflictMessage);
    }
  }

  private assertCanMutate(companyId: string, user: AuthUser) {
    if (user.role === Role.COMPANY_USER) {
      if (!user.companyId || user.companyId !== companyId) {
        throw new ForbiddenException("Resource belongs to another company");
      }
      return;
    }
    if (user.role !== Role.SUPER_ADMIN) {
      throw new ForbiddenException(
        "Only authorized Company users can perform OutCheck.",
      );
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
    if (
      user.role === Role.COMPANY_USER &&
      user.companyId !== flight.companyId
    ) {
      throw new ForbiddenException("Resource belongs to another company");
    }
    if (
      user.role === Role.MOVEMENT_SUPERVISOR &&
      flight.dailyCompanySession.dailyDuty.movementSupervisorId !== user.id
    ) {
      const activeDuty = await this.prisma.dailyDuty.findFirst({
        where: {
          movementSupervisorId: user.id,
          status: "OPEN",
          expiresAt: { gt: new Date() },
        },
        select: { id: true },
        orderBy: { activatedAt: "desc" },
      });
      if (
        !flight.isCarryOver ||
        !activeDuty ||
        flight.carriedToDailyDutyId !== activeDuty.id ||
        (flight.handoverStatus !== HandoverStatus.ACCEPTED &&
          flight.handoverStatus !== HandoverStatus.COMPLETED)
      ) {
        throw new ForbiddenException("Access denied");
      }
    }
  }

  private assertPendingFlight(status: DailySessionFlightStatus) {
    if (status !== DailySessionFlightStatus.OUTCHECK_PENDING) {
      throw new ConflictException("Flight is not pending OutCheck.");
    }
  }

  private assertInProgress(status: DailyFlightOutCheckStatus) {
    if (status !== DailyFlightOutCheckStatus.IN_PROGRESS) {
      throw new ConflictException("OutCheck has already been submitted.");
    }
  }

  private async loadResponse(tx: Prisma.TransactionClient, outCheckId: string) {
    const outCheck = await tx.dailyFlightOutCheck.findUniqueOrThrow({
      where: { id: outCheckId },
      include: outCheckResponseInclude,
    });
    return mapDailyFlightOutCheckResponse(
      outCheck satisfies OutCheckResponseRecord,
    );
  }
}
