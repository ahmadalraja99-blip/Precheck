import { BadRequestException, Injectable } from "@nestjs/common";
import {
  DailyFlightOutCheckStatus,
  DailyFlightOutCheckSubmissionStatus,
  DailySessionFlightStatus,
  Prisma,
} from "@prisma/client";
import { AuthUser } from "../../../common/types/auth-user.type";
import { PrismaService } from "../../../prisma/prisma.service";
import { assertDailyFlightOutCheckReviewerAuthority } from "../reviews/daily-flight-outcheck-reviewer-policy";
import { mapDailyFlightOutCheckReviewQueueItem } from "./daily-flight-outcheck-review-queue-response.mapper";
import { ListDailyFlightOutCheckReviewQueueDto } from "./dto";

interface QueueIdRow {
  id: string;
}

interface QueueCountRow {
  total: bigint;
}

const queueSelect = {
  id: true,
  attemptNumber: true,
  status: true,
  submittedAt: true,
  submittedBy: { select: { fullName: true } },
  totalCount: true,
  passCount: true,
  failCount: true,
  notApplicableCount: true,
  outCheck: {
    select: {
      dailySessionFlight: {
        select: {
          id: true,
          flight: {
            select: {
              flightNumber: true,
              origin: true,
              destination: true,
              scheduledDepartureAt: true,
            },
          },
          company: { select: { code: true, name: true } },
          movementCategory: { select: { code: true, name: true } },
          dailyCompanySession: {
            select: {
              dailyDuty: {
                select: {
                  status: true,
                  activatedAt: true,
                  expiresAt: true,
                  closedAt: true,
                },
              },
            },
          },
        },
      },
    },
  },
} satisfies Prisma.DailyFlightOutCheckSubmissionSelect;

@Injectable()
export class DailyFlightOutCheckReviewQueueService {
  constructor(private readonly prisma: PrismaService) {}

  async list(query: ListDailyFlightOutCheckReviewQueueDto, user: AuthUser) {
    const reviewer = await this.loadReviewer(user.id);
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;
    if (
      query.submittedFrom &&
      query.submittedTo &&
      new Date(query.submittedFrom) > new Date(query.submittedTo)
    ) {
      throw new BadRequestException(
        "submittedFrom must not be after submittedTo.",
      );
    }
    const offset = (page - 1) * limit;
    const predicates = this.buildPredicates(query, reviewer);
    const where = Prisma.sql`WHERE ${Prisma.join(predicates, " AND ")}`;

    const { idRows, countRows, submissions } = await this.prisma.$transaction(
      async (tx) => {
        const pageRows = await tx.$queryRaw<QueueIdRow[]>(Prisma.sql`
          SELECT submission.id
          FROM "DailyFlightOutCheckSubmission" submission
          INNER JOIN "DailyFlightOutCheck" outcheck
            ON outcheck.id = submission."outCheckId"
          INNER JOIN "DailySessionFlight" session_flight
            ON session_flight.id = outcheck."dailySessionFlightId"
          INNER JOIN "Flight" flight
            ON flight.id = session_flight."flightId"
          ${where}
          ORDER BY submission."submittedAt" ASC NULLS LAST,
                   submission."attemptNumber" ASC,
                   submission.id ASC
          OFFSET ${offset}
          LIMIT ${limit}
        `);
        const totals = await tx.$queryRaw<QueueCountRow[]>(Prisma.sql`
          SELECT COUNT(*)::bigint AS total
          FROM "DailyFlightOutCheckSubmission" submission
          INNER JOIN "DailyFlightOutCheck" outcheck
            ON outcheck.id = submission."outCheckId"
          INNER JOIN "DailySessionFlight" session_flight
            ON session_flight.id = outcheck."dailySessionFlightId"
          INNER JOIN "Flight" flight
            ON flight.id = session_flight."flightId"
          ${where}
        `);
        const records = pageRows.length
          ? await tx.dailyFlightOutCheckSubmission.findMany({
              where: { id: { in: pageRows.map(({ id }) => id) } },
              select: queueSelect,
            })
          : [];
        return { idRows: pageRows, countRows: totals, submissions: records };
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead },
    );

    const byId = new Map(
      submissions.map((submission) => [submission.id, submission]),
    );
    const ordered = idRows.flatMap(({ id }) => {
      const submission = byId.get(id);
      return submission ? [submission] : [];
    });

    return {
      items: ordered.map((submission) =>
        mapDailyFlightOutCheckReviewQueueItem(submission),
      ),
      meta: { total: Number(countRows[0]?.total ?? 0n), page, limit },
    };
  }

  private async loadReviewer(userId: string) {
    const reviewer = await this.prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        fullName: true,
        role: true,
        companyId: true,
        isActive: true,
        permissions: {
          select: { permission: { select: { code: true } } },
        },
      },
    });
    return assertDailyFlightOutCheckReviewerAuthority(reviewer);
  }

  private buildPredicates(
    query: ListDailyFlightOutCheckReviewQueueDto,
    reviewer: ReturnType<typeof assertDailyFlightOutCheckReviewerAuthority>,
  ) {
    const predicates: Prisma.Sql[] = [
      Prisma.sql`submission.status = ${DailyFlightOutCheckSubmissionStatus.PENDING_REVIEW}::"DailyFlightOutCheckSubmissionStatus"`,
      Prisma.sql`outcheck.status = ${DailyFlightOutCheckStatus.SUBMITTED}::"DailyFlightOutCheckStatus"`,
      Prisma.sql`session_flight.status = ${DailySessionFlightStatus.OUTCHECK_PENDING}::"DailySessionFlightStatus"`,
      Prisma.sql`submission."submittedById" IS DISTINCT FROM ${reviewer.id}`,
      Prisma.sql`outcheck."startedById" <> ${reviewer.id}`,
      Prisma.sql`submission."totalCount" >= 0`,
      Prisma.sql`submission."passCount" >= 0`,
      Prisma.sql`submission."failCount" >= 0`,
      Prisma.sql`submission."notApplicableCount" >= 0`,
      Prisma.sql`submission."passCount" + submission."failCount" + submission."notApplicableCount" = submission."totalCount"`,
      Prisma.sql`NOT EXISTS (
        SELECT 1 FROM "DailyFlightOutCheckReview" review
        WHERE review."submissionId" = submission.id
      )`,
      Prisma.sql`NOT EXISTS (
        SELECT 1 FROM "DailyFlightOutCheckSubmission" newer
        WHERE newer."outCheckId" = submission."outCheckId"
          AND newer."attemptNumber" > submission."attemptNumber"
      )`,
      Prisma.sql`(
        SELECT COUNT(*)
        FROM "DailyFlightOutCheckSubmission" pending
        WHERE pending."outCheckId" = submission."outCheckId"
          AND pending.status = ${DailyFlightOutCheckSubmissionStatus.PENDING_REVIEW}::"DailyFlightOutCheckSubmissionStatus"
      ) = 1`,
    ];
    if (reviewer.companyId !== null) {
      predicates.push(
        Prisma.sql`session_flight."companyId" <> ${reviewer.companyId}`,
      );
    }
    if (query.companyId) {
      predicates.push(
        Prisma.sql`session_flight."companyId" = ${query.companyId}`,
      );
    }
    if (query.movementCategoryId) {
      predicates.push(
        Prisma.sql`session_flight."movementCategoryId" = ${query.movementCategoryId}`,
      );
    }
    if (query.submittedFrom) {
      predicates.push(
        Prisma.sql`submission."submittedAt" >= ${new Date(query.submittedFrom)}`,
      );
    }
    if (query.submittedTo) {
      predicates.push(
        Prisma.sql`submission."submittedAt" <= ${new Date(query.submittedTo)}`,
      );
    }
    if (query.flightNumber) {
      predicates.push(
        Prisma.sql`flight."flightNumber" ILIKE ${`%${query.flightNumber}%`}`,
      );
    }
    return predicates;
  }
}
