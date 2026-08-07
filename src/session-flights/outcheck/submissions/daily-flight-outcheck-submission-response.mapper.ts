import {
  DailyFlightCheckResult,
  DailyFlightOutCheckReviewDecision,
  DailyFlightOutCheckSubmissionStatus,
} from "@prisma/client";

export interface SubmissionSummaryRecord {
  attemptNumber: number;
  status: DailyFlightOutCheckSubmissionStatus;
  submittedAt: Date | null;
  submittedBy: { id: string; fullName: string } | null;
  totalCount: number;
  passCount: number;
  failCount: number;
  notApplicableCount: number;
  review?: {
    decision: DailyFlightOutCheckReviewDecision;
    reviewedAt: Date;
    reviewedBy: { id: string; fullName: string };
    approvalComment?: string | null;
    rejectionReason?: string | null;
  } | null;
}

export interface SubmissionDetailRecord extends SubmissionSummaryRecord {
  items: Array<{
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
}

export function mapDailyFlightOutCheckSubmissionSummary(
  submission: SubmissionSummaryRecord,
) {
  return {
    attemptNumber: submission.attemptNumber,
    status: submission.status,
    submittedAt: submission.submittedAt,
    submittedBy: submission.submittedBy,
    summary: {
      total: submission.totalCount,
      passed: submission.passCount,
      failed: submission.failCount,
      notApplicable: submission.notApplicableCount,
    },
    review: submission.review
      ? {
          decision: submission.review.decision,
          reviewedAt: submission.review.reviewedAt,
          reviewedBy: submission.review.reviewedBy,
        }
      : null,
  };
}

export function mapDailyFlightOutCheckSubmissionDetail(
  submission: SubmissionDetailRecord,
) {
  const counters = new Map<
    string,
    {
      counter: { code: string; name: string };
      items: Array<{
        checkItem: {
          name: string;
          description: string | null;
          category: string;
          isRequired: boolean;
        };
        result: DailyFlightCheckResult;
        note: string | null;
      }>;
    }
  >();

  for (const item of submission.items) {
    let counter = counters.get(item.counterCodeSnapshot);
    if (!counter) {
      counter = {
        counter: {
          code: item.counterCodeSnapshot,
          name: item.counterNameSnapshot,
        },
        items: [],
      };
      counters.set(item.counterCodeSnapshot, counter);
    }
    counter.items.push({
      checkItem: {
        name: item.checkItemNameSnapshot,
        description: item.checkItemDescriptionSnapshot,
        category: item.checkItemCategorySnapshot,
        isRequired: item.checkItemRequiredSnapshot,
      },
      result: item.result,
      note: item.note,
    });
  }

  const summary = mapDailyFlightOutCheckSubmissionSummary(submission);
  return {
    ...summary,
    review: submission.review
      ? {
          decision: submission.review.decision,
          reviewedAt: submission.review.reviewedAt,
          reviewedBy: submission.review.reviewedBy,
          approvalComment: submission.review.approvalComment ?? null,
          rejectionReason: submission.review.rejectionReason ?? null,
        }
      : null,
    counters: [...counters.values()],
  };
}
