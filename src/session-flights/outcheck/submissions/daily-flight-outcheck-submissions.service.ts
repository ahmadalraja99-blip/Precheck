import { Injectable, NotFoundException } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { AuthUser } from "../../../common/types/auth-user.type";
import { PrismaService } from "../../../prisma/prisma.service";
import { DailyFlightOutChecksService } from "../daily-flight-outchecks.service";
import {
  mapDailyFlightOutCheckSubmissionDetail,
  mapDailyFlightOutCheckSubmissionSummary,
} from "./daily-flight-outcheck-submission-response.mapper";

const submittedBySelect = {
  id: true,
  fullName: true,
} satisfies Prisma.UserSelect;

@Injectable()
export class DailyFlightOutCheckSubmissionsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly outChecks: DailyFlightOutChecksService,
  ) {}

  async list(sessionFlightId: string, user: AuthUser) {
    const outCheck = await this.outChecks.findForRead(sessionFlightId, user);
    const submissions =
      await this.prisma.dailyFlightOutCheckSubmission.findMany({
        where: { outCheckId: outCheck.id },
        select: {
          attemptNumber: true,
          status: true,
          submittedAt: true,
          submittedBy: { select: submittedBySelect },
          totalCount: true,
          passCount: true,
          failCount: true,
          notApplicableCount: true,
          review: {
            select: {
              decision: true,
              reviewedAt: true,
              reviewedBy: { select: submittedBySelect },
            },
          },
        },
        orderBy: { attemptNumber: "desc" },
        take: 100,
      });
    return submissions.map(mapDailyFlightOutCheckSubmissionSummary);
  }

  async find(sessionFlightId: string, attemptNumber: number, user: AuthUser) {
    const outCheck = await this.outChecks.findForRead(sessionFlightId, user);
    const submission =
      await this.prisma.dailyFlightOutCheckSubmission.findUnique({
        where: {
          outCheckId_attemptNumber: {
            outCheckId: outCheck.id,
            attemptNumber,
          },
        },
        select: {
          attemptNumber: true,
          status: true,
          submittedAt: true,
          submittedBy: { select: submittedBySelect },
          totalCount: true,
          passCount: true,
          failCount: true,
          notApplicableCount: true,
          review: {
            select: {
              decision: true,
              reviewedAt: true,
              approvalComment: true,
              rejectionReason: true,
              reviewedBy: { select: submittedBySelect },
            },
          },
          items: {
            select: {
              counterCodeSnapshot: true,
              counterNameSnapshot: true,
              checkItemNameSnapshot: true,
              checkItemDescriptionSnapshot: true,
              checkItemCategorySnapshot: true,
              checkItemRequiredSnapshot: true,
              checkItemOrderSnapshot: true,
              result: true,
              note: true,
            },
            orderBy: [
              { counterCodeSnapshot: "asc" },
              { checkItemCategorySnapshot: "asc" },
              { checkItemOrderSnapshot: "asc" },
              { checkItemNameSnapshot: "asc" },
            ],
          },
        },
      });
    if (!submission)
      throw new NotFoundException("OutCheck submission attempt not found.");
    return mapDailyFlightOutCheckSubmissionDetail(submission);
  }
}
