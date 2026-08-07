import {
  DailyFlightOutCheckReviewDecision,
  DailyFlightOutCheckStatus,
  DailySessionFlightStatus,
} from "@prisma/client";

export function mapApprovedOutCheckReviewResponse(input: {
  attemptNumber: number;
  reviewedAt: Date;
  reviewedBy: { id: string; fullName: string };
  approvalComment: string | null;
  reservationCount: number;
}) {
  return {
    decision: DailyFlightOutCheckReviewDecision.APPROVED,
    attemptNumber: input.attemptNumber,
    reviewedAt: input.reviewedAt,
    reviewedBy: input.reviewedBy,
    approvalComment: input.approvalComment,
    outCheckStatus: DailyFlightOutCheckStatus.APPROVED,
    flightStatus: DailySessionFlightStatus.CLOSED,
    reservationSummary: {
      total: input.reservationCount,
      released: input.reservationCount,
    },
  };
}

export function mapRejectedOutCheckReviewResponse(input: {
  attemptNumber: number;
  reviewedAt: Date;
  reviewedBy: { id: string; fullName: string };
  rejectionReason: string;
}) {
  return {
    decision: DailyFlightOutCheckReviewDecision.REJECTED,
    attemptNumber: input.attemptNumber,
    reviewedAt: input.reviewedAt,
    reviewedBy: input.reviewedBy,
    rejectionReason: input.rejectionReason,
    outCheckStatus: DailyFlightOutCheckStatus.IN_PROGRESS,
    flightStatus: DailySessionFlightStatus.OUTCHECK_PENDING,
  };
}
