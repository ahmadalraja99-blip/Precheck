ALTER TYPE "DailyFlightOutCheckStatus" ADD VALUE 'APPROVED';

CREATE TYPE "DailyFlightOutCheckReviewDecision" AS ENUM ('APPROVED', 'REJECTED');

CREATE TABLE "DailyFlightOutCheckReview" (
    "id" TEXT NOT NULL,
    "submissionId" TEXT NOT NULL,
    "decision" "DailyFlightOutCheckReviewDecision" NOT NULL,
    "reviewedById" TEXT NOT NULL,
    "reviewedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "approvalComment" TEXT,
    "rejectionReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DailyFlightOutCheckReview_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "DailyFlightOutCheckReview_text_check" CHECK (
        (
            "decision" = 'APPROVED'
            AND "rejectionReason" IS NULL
        )
        OR
        (
            "decision" = 'REJECTED'
            AND "approvalComment" IS NULL
            AND "rejectionReason" IS NOT NULL
            AND length(btrim("rejectionReason")) BETWEEN 1 AND 1000
        )
    ),
    CONSTRAINT "DailyFlightOutCheckReview_approval_comment_length_check" CHECK (
        "approvalComment" IS NULL OR length("approvalComment") <= 1000
    )
);

CREATE UNIQUE INDEX "DailyFlightOutCheckReview_submissionId_key"
ON "DailyFlightOutCheckReview"("submissionId");

CREATE INDEX "DailyFlightOutCheckReview_reviewedById_idx"
ON "DailyFlightOutCheckReview"("reviewedById");

CREATE INDEX "DailyFlightOutCheckReview_decision_reviewedAt_idx"
ON "DailyFlightOutCheckReview"("decision", "reviewedAt");

ALTER TABLE "DailyFlightOutCheckReview"
ADD CONSTRAINT "DailyFlightOutCheckReview_submissionId_fkey"
FOREIGN KEY ("submissionId") REFERENCES "DailyFlightOutCheckSubmission"("id")
ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "DailyFlightOutCheckReview"
ADD CONSTRAINT "DailyFlightOutCheckReview_reviewedById_fkey"
FOREIGN KEY ("reviewedById") REFERENCES "User"("id")
ON DELETE RESTRICT ON UPDATE CASCADE;
