import {
  ConflictException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import {
  CounterStatus,
  CounterReservationStatus,
  DailyFlightCheckResult,
  DailyFlightOutCheckReviewDecision,
  DailyFlightOutCheckStatus,
  DailyFlightOutCheckSubmissionStatus,
  OperationalReportFormat,
  OperationalReportGenerationType,
  DailySessionFlightStatus,
  PermissionCode,
  IssueStatus,
  NotificationType,
  Prisma,
} from "@prisma/client";
import { OPERATIONAL_REPORT_TEMPLATE_VERSION } from "../../../operational-reports/operational-report.constants";
import { AuditService } from "../../../audit/audit.service";
import { lockDailySessionFlightRows } from "../../../common/database/daily-session-flight-lock";
import {
  lockDailyFlightOutCheckItemRows,
  lockDailyFlightOutCheckRows,
} from "../../../common/database/outcheck-lock";
import { lockDailyFlightOutCheckReviewRows } from "../../../common/database/outcheck-review-lock";
import {
  lockDailyFlightOutCheckSubmissionItemRows,
  lockDailyFlightOutCheckSubmissionRows,
} from "../../../common/database/outcheck-submission-lock";
import { lockCounterReservationRows } from "../../../common/database/precheck-lock";
import { AuthUser } from "../../../common/types/auth-user.type";
import { PrismaService } from "../../../prisma/prisma.service";
import { assertDailySessionFlightTransitionAllowed } from "../../daily-session-flight-status-machine";
import {
  mapApprovedOutCheckReviewResponse,
  mapRejectedOutCheckReviewResponse,
} from "./daily-flight-outcheck-review-response.mapper";
import {
  assertDailyFlightOutCheckReviewerAuthority,
  assertDailyFlightOutCheckReviewerEligible,
} from "./daily-flight-outcheck-reviewer-policy";

type ReviewDecisionInput =
  | {
      decision: typeof DailyFlightOutCheckReviewDecision.APPROVED;
      text: string | null;
    }
  | {
      decision: typeof DailyFlightOutCheckReviewDecision.REJECTED;
      text: string;
    };

@Injectable()
export class DailyFlightOutCheckReviewsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  approve(
    sessionFlightId: string,
    attemptNumber: number,
    comment: string | undefined,
    user: AuthUser,
  ) {
    return this.review(
      sessionFlightId,
      attemptNumber,
      {
        decision: DailyFlightOutCheckReviewDecision.APPROVED,
        text: comment?.trim() || null,
      },
      user,
    );
  }

  reject(
    sessionFlightId: string,
    attemptNumber: number,
    reason: string,
    user: AuthUser,
  ) {
    const trimmedReason = reason.trim();
    if (!trimmedReason)
      throw new ConflictException("A rejection reason is required.");
    return this.review(
      sessionFlightId,
      attemptNumber,
      {
        decision: DailyFlightOutCheckReviewDecision.REJECTED,
        text: trimmedReason,
      },
      user,
    );
  }

  private async review(
    sessionFlightId: string,
    attemptNumber: number,
    input: ReviewDecisionInput,
    user: AuthUser,
  ) {
    try {
      return await this.prisma.$transaction(async (tx) => {
        const lockedFlight = await lockDailySessionFlightRows(tx, [
          sessionFlightId,
        ]);
        if (!lockedFlight.length)
          throw new NotFoundException("Session flight not found");
        const flight = await tx.dailySessionFlight.findUnique({
          where: { id: sessionFlightId },
          select: { id: true, companyId: true, status: true },
        });
        if (!flight) throw new NotFoundException("Session flight not found");

        const outCheckCandidate = await tx.dailyFlightOutCheck.findUnique({
          where: { dailySessionFlightId: sessionFlightId },
          select: { id: true },
        });
        if (!outCheckCandidate)
          throw new NotFoundException("OutCheck has not started.");
        await lockDailyFlightOutCheckRows(tx, [outCheckCandidate.id]);
        const outCheck = await tx.dailyFlightOutCheck.findUniqueOrThrow({
          where: { id: outCheckCandidate.id },
          select: { id: true, status: true, startedById: true },
        });

        const attemptCandidate =
          await tx.dailyFlightOutCheckSubmission.findUnique({
            where: {
              outCheckId_attemptNumber: {
                outCheckId: outCheck.id,
                attemptNumber,
              },
            },
            select: { id: true },
          });
        if (!attemptCandidate)
          throw new NotFoundException("OutCheck submission attempt not found.");
        await lockDailyFlightOutCheckSubmissionRows(tx, [attemptCandidate.id]);
        const attempt =
          await tx.dailyFlightOutCheckSubmission.findUniqueOrThrow({
            where: { id: attemptCandidate.id },
            include: {
              items: { orderBy: { id: "asc" } },
              review: {
                include: {
                  reviewedBy: { select: { id: true, fullName: true } },
                },
              },
            },
          });
        if (attempt.review)
          await lockDailyFlightOutCheckReviewRows(tx, [attempt.review.id]);

        const itemIds = attempt.items.map(({ id }) => id);
        await lockDailyFlightOutCheckSubmissionItemRows(tx, itemIds);
        const sourceIds = attempt.items.map(
          ({ sourceWorkingItemId }) => sourceWorkingItemId,
        );
        if (sourceIds.some((id) => id === null)) {
          throw new ConflictException(
            "Immutable OutCheck evidence cannot be verified.",
          );
        }
        const workingItemIds = sourceIds.filter(
          (id): id is string => id !== null,
        );
        await lockDailyFlightOutCheckItemRows(tx, workingItemIds);
        const workingItems = await tx.dailyFlightOutCheckItemResult.findMany({
          where: { id: { in: workingItemIds }, outCheckId: outCheck.id },
          select: { id: true, counterReservationId: true },
          orderBy: { id: "asc" },
        });
        if (
          workingItems.length !== workingItemIds.length ||
          workingItems.some(
            ({ counterReservationId }) => counterReservationId === null,
          )
        ) {
          throw new ConflictException(
            "Immutable OutCheck evidence cannot be verified.",
          );
        }

        const reservationIds = [
          ...new Set(
            workingItems
              .map(({ counterReservationId }) => counterReservationId)
              .filter((id): id is string => id !== null),
          ),
        ].sort();
        if (!reservationIds.length) {
          throw new ConflictException(
            "Counter Reservation evidence cannot be verified.",
          );
        }
        await lockCounterReservationRows(tx, reservationIds);
        const reservations = await tx.counterReservation.findMany({
          where: { dailySessionFlightId: sessionFlightId },
          select: { id: true, status: true },
          orderBy: { id: "asc" },
        });

        const reviewer = await this.assertReviewerAuthorized(
          tx,
          user,
          flight.companyId,
          outCheck.startedById,
          attempt.submittedById,
        );
        this.assertEvidence(attempt);

        const attempts = await tx.dailyFlightOutCheckSubmission.findMany({
          where: { outCheckId: outCheck.id },
          select: { attemptNumber: true, status: true },
          orderBy: { attemptNumber: "desc" },
        });
        if (attempts[0]?.attemptNumber !== attemptNumber) {
          throw new ConflictException(
            "This OutCheck submission attempt is stale.",
          );
        }

        if (attempt.review) {
          return this.resolveRetry(
            input,
            attempt,
            outCheck.status,
            flight.status,
            reservations,
            reservationIds,
          );
        }
        if (
          attempts.filter(
            ({ status }) =>
              status === DailyFlightOutCheckSubmissionStatus.PENDING_REVIEW,
          ).length !== 1 ||
          attempt.status !==
            DailyFlightOutCheckSubmissionStatus.PENDING_REVIEW ||
          outCheck.status !== DailyFlightOutCheckStatus.SUBMITTED ||
          flight.status !== DailySessionFlightStatus.OUTCHECK_PENDING
        ) {
          throw new ConflictException(
            "OutCheck submission is not ready for review.",
          );
        }
        this.assertReservationSet(
          reservations,
          reservationIds,
          CounterReservationStatus.ACTIVE,
        );

        if (input.decision === DailyFlightOutCheckReviewDecision.APPROVED) {
          if (
            attempt.failCount > 0 ||
            attempt.items.some(
              ({ result }) => result === DailyFlightCheckResult.FAIL,
            )
          ) {
            throw new ConflictException(
              "This OutCheck submission contains failed Check Items and cannot be approved.",
            );
          }
          return this.commitApproval(
            tx,
            input.text,
            reviewer,
            flight.id,
            outCheck.id,
            attempt,
            reservationIds,
            user,
          );
        }
          return this.commitRejection(
          tx,
          input.text,
          reviewer,
            flight.id,
            flight.companyId,
          outCheck.id,
          attempt,
          reservationIds.length,
          user,
        );
      });
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === "P2002"
      ) {
        throw new ConflictException(
          "OutCheck submission was reviewed concurrently.",
        );
      }
      throw error;
    }
  }

  private async assertReviewerAuthorized(
    tx: Prisma.TransactionClient,
    user: AuthUser,
    flightCompanyId: string,
    startedById: string,
    submittedById: string | null,
  ) {
    const reviewer = await tx.user.findUnique({
      where: { id: user.id },
      include: { permissions: { include: { permission: true } } },
    });
    const authorized = assertDailyFlightOutCheckReviewerAuthority(reviewer);
    assertDailyFlightOutCheckReviewerEligible(authorized, {
      flightCompanyId,
      startedById,
      submittedById,
    });
    return { id: authorized.id, fullName: authorized.fullName };
  }

  private assertEvidence(attempt: {
    totalCount: number;
    passCount: number;
    failCount: number;
    notApplicableCount: number;
    items: Array<{ result: DailyFlightCheckResult }>;
  }) {
    const pass = attempt.items.filter(
      ({ result }) => result === DailyFlightCheckResult.PASS,
    ).length;
    const fail = attempt.items.filter(
      ({ result }) => result === DailyFlightCheckResult.FAIL,
    ).length;
    const notApplicable = attempt.items.filter(
      ({ result }) => result === DailyFlightCheckResult.NOT_APPLICABLE,
    ).length;
    if (
      attempt.totalCount !== attempt.items.length ||
      attempt.passCount !== pass ||
      attempt.failCount !== fail ||
      attempt.notApplicableCount !== notApplicable ||
      pass + fail + notApplicable !== attempt.totalCount
    ) {
      throw new ConflictException(
        "Immutable OutCheck evidence is inconsistent.",
      );
    }
  }

  private assertReservationSet(
    current: Array<{ id: string; status: CounterReservationStatus }>,
    expectedIds: string[],
    expectedStatus: CounterReservationStatus,
  ) {
    const expected = new Set(expectedIds);
    if (
      current.length !== expected.size ||
      current.some(
        ({ id, status }) => !expected.has(id) || status !== expectedStatus,
      )
    ) {
      throw new ConflictException(
        "Counter Reservation evidence cannot be verified.",
      );
    }
  }

  private async commitApproval(
    tx: Prisma.TransactionClient,
    comment: string | null,
    reviewer: { id: string; fullName: string },
    flightId: string,
    outCheckId: string,
    attempt: { id: string; attemptNumber: number; submittedById: string | null },
    reservationIds: string[],
    user: AuthUser,
  ) {
    const unresolved = await tx.dailyFlightOperationalIssue.count({ where: { dailySessionFlightId: flightId,
      status: { in: [IssueStatus.OPEN, IssueStatus.IN_PROGRESS] } } });
    if (unresolved) throw new ConflictException('Operational issues must be resolved before final approval.');
    const reviewedAt = new Date();
    const review = await tx.dailyFlightOutCheckReview.create({
      data: {
        submissionId: attempt.id,
        decision: DailyFlightOutCheckReviewDecision.APPROVED,
        reviewedById: reviewer.id,
        reviewedAt,
        approvalComment: comment,
      },
    });
    const attemptUpdate = await tx.dailyFlightOutCheckSubmission.updateMany({
      where: {
        id: attempt.id,
        status: DailyFlightOutCheckSubmissionStatus.PENDING_REVIEW,
      },
      data: { status: DailyFlightOutCheckSubmissionStatus.APPROVED },
    });
    if (attemptUpdate.count !== 1)
      throw new ConflictException("Submission changed concurrently.");
    await tx.dailyFlightOutCheck.update({
      where: { id: outCheckId },
      data: { status: DailyFlightOutCheckStatus.APPROVED },
    });
    assertDailySessionFlightTransitionAllowed(
      DailySessionFlightStatus.OUTCHECK_PENDING,
      DailySessionFlightStatus.CLOSED,
    );
    const released = await tx.counterReservation.updateMany({
      where: {
        id: { in: reservationIds },
        status: CounterReservationStatus.ACTIVE,
      },
      data: { status: CounterReservationStatus.RELEASED },
    });
    if (released.count !== reservationIds.length) {
      throw new ConflictException(
        "Counter Reservation release changed concurrently.",
      );
    }
    await tx.dailySessionFlight.update({
      where: { id: flightId },
      data: { status: DailySessionFlightStatus.CLOSED },
    });
    const maxAttempts = this.reportJobMaxAttempts();
    for (const format of [OperationalReportFormat.PDF, OperationalReportFormat.EXCEL]) {
      const key = {
        dailySessionFlightId: flightId,
        format,
        generationType: OperationalReportGenerationType.AUTOMATIC_FINAL_CLOSE,
        templateVersion: OPERATIONAL_REPORT_TEMPLATE_VERSION,
      };
      const job = await tx.operationalReportJob.upsert({
        where: { dailySessionFlightId_format_generationType_templateVersion: key },
        create: { ...key, maxAttempts },
        update: {},
      });
      await this.audit.record({
        user,
        action: "ENQUEUE_OPERATIONAL_REPORT_JOB",
        entityType: "DailySessionFlight",
        entityId: flightId,
        metadata: {
          jobId: job.id,
          flightId,
          format,
          generationType: OperationalReportGenerationType.AUTOMATIC_FINAL_CLOSE,
          templateVersion: OPERATIONAL_REPORT_TEMPLATE_VERSION,
        },
      }, tx);
    }
    await this.audit.record(
      {
        user,
        permissionUsed: PermissionCode.CAN_APPROVE_OUTCHECK,
        action: "APPROVE_DAILY_FLIGHT_OUTCHECK_SUBMISSION",
        entityType: "DailySessionFlight",
        entityId: flightId,
        metadata: {
          attemptNumber: attempt.attemptNumber,
          previousSubmissionStatus:
            DailyFlightOutCheckSubmissionStatus.PENDING_REVIEW,
          nextSubmissionStatus: DailyFlightOutCheckSubmissionStatus.APPROVED,
          previousOutCheckStatus: DailyFlightOutCheckStatus.SUBMITTED,
          nextOutCheckStatus: DailyFlightOutCheckStatus.APPROVED,
          previousFlightStatus: DailySessionFlightStatus.OUTCHECK_PENDING,
          nextFlightStatus: DailySessionFlightStatus.CLOSED,
          releasedReservations: released.count,
          zeroFailConfirmed: true,
          separationOfDutiesConfirmed: true,
        },
      },
      tx,
    );
    return mapApprovedOutCheckReviewResponse({
      attemptNumber: attempt.attemptNumber,
      reviewedAt: review.reviewedAt,
      reviewedBy: reviewer,
      approvalComment: review.approvalComment,
      reservationCount: released.count,
    });
  }

  private reportJobMaxAttempts() {
    const parsed = Number(process.env.OPERATIONAL_REPORT_JOB_MAX_ATTEMPTS ?? 5);
    return Number.isInteger(parsed) && parsed > 0 ? parsed : 5;
  }

  private async commitRejection(
    tx: Prisma.TransactionClient,
    reason: string,
    reviewer: { id: string; fullName: string },
    flightId: string,
    companyId: string,
    outCheckId: string,
    attempt: { id: string; attemptNumber: number; submittedById: string | null },
    activeReservationCount: number,
    user: AuthUser,
  ) {
    const review = await tx.dailyFlightOutCheckReview.create({
      data: {
        submissionId: attempt.id,
        decision: DailyFlightOutCheckReviewDecision.REJECTED,
        reviewedById: reviewer.id,
        rejectionReason: reason,
      },
    });
    const attemptUpdate = await tx.dailyFlightOutCheckSubmission.updateMany({
      where: {
        id: attempt.id,
        status: DailyFlightOutCheckSubmissionStatus.PENDING_REVIEW,
      },
      data: { status: DailyFlightOutCheckSubmissionStatus.REJECTED },
    });
    if (attemptUpdate.count !== 1)
      throw new ConflictException("Submission changed concurrently.");
    await tx.dailyFlightOutCheck.update({
      where: { id: outCheckId },
      data: {
        status: DailyFlightOutCheckStatus.IN_PROGRESS,
        submittedById: null,
        submittedAt: null,
      },
    });
    const failedItems = await tx.dailyFlightOutCheckSubmissionItem.findMany({
      where: { submissionId: attempt.id, result: DailyFlightCheckResult.FAIL },
      include: { sourceWorkingItem: { include: { counterReservation: true } } },
    });
    const affectedCounterIds = [...new Set(failedItems.map((item) => item.sourceWorkingItem?.counterReservation?.counterId)
      .filter((id): id is string => Boolean(id)))];
    for (const item of failedItems) {
      const working = item.sourceWorkingItem; const reservation = working?.counterReservation;
      if (!working || !reservation || !item.note?.trim()) throw new ConflictException('Failed item evidence is incomplete.');
      await tx.dailyFlightOperationalIssue.upsert({ where: { outCheckSubmissionItemId: item.id }, create: {
        dailySessionFlightId: flightId, counterId: reservation.counterId, checkItemId: working.checkItemId,
        outCheckSubmissionItemId: item.id, attemptNumber: attempt.attemptNumber,
        counterCodeSnapshot: item.counterCodeSnapshot, checkItemNameSnapshot: item.checkItemNameSnapshot,
        checkItemDescriptionSnapshot: item.checkItemDescriptionSnapshot, result: item.result, failureNote: item.note,
        rejectionReason: reason, reportedById: attempt.submittedById ?? user.id,
      }, update: { rejectionReason: reason } });
    }
    if (affectedCounterIds.length) await tx.counter.updateMany({ where: { id: { in: affectedCounterIds },
      status: { not: CounterStatus.OUT_OF_SERVICE } }, data: { status: CounterStatus.UNAVAILABLE,
      notes: `OutCheck attempt ${attempt.attemptNumber} rejected: ${reason}` } });
    await tx.notification.create({ data: { title: 'OutCheck rejected',
      message: `Attempt ${attempt.attemptNumber} was rejected: ${reason}`,
      type: NotificationType.OUTCHECK_REJECTED, targetCompanyId: companyId,
      entityType: 'DailySessionFlight', entityId: flightId } });
    await this.audit.record(
      {
        user,
        permissionUsed: PermissionCode.CAN_APPROVE_OUTCHECK,
        action: "REJECT_DAILY_FLIGHT_OUTCHECK_SUBMISSION",
        entityType: "DailySessionFlight",
        entityId: flightId,
        metadata: {
          attemptNumber: attempt.attemptNumber,
          previousSubmissionStatus:
            DailyFlightOutCheckSubmissionStatus.PENDING_REVIEW,
          nextSubmissionStatus: DailyFlightOutCheckSubmissionStatus.REJECTED,
          previousOutCheckStatus: DailyFlightOutCheckStatus.SUBMITTED,
          nextOutCheckStatus: DailyFlightOutCheckStatus.IN_PROGRESS,
          flightStatus: DailySessionFlightStatus.OUTCHECK_PENDING,
          activeReservations: activeReservationCount,
          affectedCounterIds,
          separationOfDutiesConfirmed: true,
        },
      },
      tx,
    );
    return mapRejectedOutCheckReviewResponse({
      attemptNumber: attempt.attemptNumber,
      reviewedAt: review.reviewedAt,
      reviewedBy: reviewer,
      rejectionReason: reason,
    });
  }

  private resolveRetry(
    input: ReviewDecisionInput,
    attempt: {
      attemptNumber: number;
      status: DailyFlightOutCheckSubmissionStatus;
      review: {
        decision: DailyFlightOutCheckReviewDecision;
        reviewedAt: Date;
        reviewedBy: { id: string; fullName: string };
        approvalComment: string | null;
        rejectionReason: string | null;
      } | null;
    },
    outCheckStatus: DailyFlightOutCheckStatus,
    flightStatus: DailySessionFlightStatus,
    reservations: Array<{ id: string; status: CounterReservationStatus }>,
    reservationIds: string[],
  ) {
    const review = attempt.review;
    if (!review || review.decision !== input.decision) {
      throw new ConflictException(
        "OutCheck submission already has the opposite decision.",
      );
    }
    if (input.decision === DailyFlightOutCheckReviewDecision.APPROVED) {
      if (
        attempt.status !== DailyFlightOutCheckSubmissionStatus.APPROVED ||
        outCheckStatus !== DailyFlightOutCheckStatus.APPROVED ||
        flightStatus !== DailySessionFlightStatus.CLOSED
      ) {
        throw new ConflictException("Approved OutCheck state is inconsistent.");
      }
      this.assertReservationSet(
        reservations,
        reservationIds,
        CounterReservationStatus.RELEASED,
      );
      return mapApprovedOutCheckReviewResponse({
        attemptNumber: attempt.attemptNumber,
        reviewedAt: review.reviewedAt,
        reviewedBy: review.reviewedBy,
        approvalComment: review.approvalComment,
        reservationCount: reservationIds.length,
      });
    }
    if (
      attempt.status !== DailyFlightOutCheckSubmissionStatus.REJECTED ||
      outCheckStatus !== DailyFlightOutCheckStatus.IN_PROGRESS ||
      flightStatus !== DailySessionFlightStatus.OUTCHECK_PENDING ||
      review.rejectionReason !== input.text
    ) {
      throw new ConflictException("Rejected OutCheck retry is inconsistent.");
    }
    this.assertReservationSet(
      reservations,
      reservationIds,
      CounterReservationStatus.ACTIVE,
    );
    return mapRejectedOutCheckReviewResponse({
      attemptNumber: attempt.attemptNumber,
      reviewedAt: review.reviewedAt,
      reviewedBy: review.reviewedBy,
      rejectionReason: review.rejectionReason,
    });
  }
}
