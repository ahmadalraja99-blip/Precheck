DO $$
BEGIN
    IF EXISTS (
        SELECT 1
        FROM "DailyFlightOutCheck" AS outcheck
        INNER JOIN "DailyFlightOutCheckItemResult" AS item
            ON item."outCheckId" = outcheck.id
        WHERE outcheck.status = 'SUBMITTED'
          AND item.result IS NULL
    ) THEN
        RAISE EXCEPTION 'Cannot backfill submitted OutChecks while unanswered items exist';
    END IF;
END
$$;

CREATE TYPE "DailyFlightOutCheckSubmissionStatus"
AS ENUM ('PENDING_REVIEW', 'APPROVED', 'REJECTED');

CREATE TABLE "DailyFlightOutCheckSubmission" (
    "id" TEXT NOT NULL,
    "outCheckId" TEXT NOT NULL,
    "attemptNumber" INTEGER NOT NULL,
    "status" "DailyFlightOutCheckSubmissionStatus" NOT NULL DEFAULT 'PENDING_REVIEW',
    "submittedById" TEXT,
    "submittedAt" TIMESTAMP(3),
    "totalCount" INTEGER NOT NULL,
    "passCount" INTEGER NOT NULL,
    "failCount" INTEGER NOT NULL,
    "notApplicableCount" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DailyFlightOutCheckSubmission_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "DailyFlightOutCheckSubmissionItem" (
    "id" TEXT NOT NULL,
    "submissionId" TEXT NOT NULL,
    "sourceWorkingItemId" TEXT,
    "counterCodeSnapshot" TEXT NOT NULL,
    "counterNameSnapshot" TEXT NOT NULL,
    "checkItemNameSnapshot" TEXT NOT NULL,
    "checkItemDescriptionSnapshot" TEXT,
    "checkItemCategorySnapshot" TEXT NOT NULL,
    "checkItemRequiredSnapshot" BOOLEAN NOT NULL,
    "checkItemOrderSnapshot" INTEGER NOT NULL,
    "result" "DailyFlightCheckResult" NOT NULL,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DailyFlightOutCheckSubmissionItem_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "DailyFlightOutCheckSubmission_outCheckId_attemptNumber_key"
ON "DailyFlightOutCheckSubmission"("outCheckId", "attemptNumber");

CREATE INDEX "DailyFlightOutCheckSubmission_outCheckId_idx"
ON "DailyFlightOutCheckSubmission"("outCheckId");

CREATE INDEX "DailyFlightOutCheckSubmission_status_submittedAt_idx"
ON "DailyFlightOutCheckSubmission"("status", "submittedAt");

CREATE UNIQUE INDEX "DailyFlightOutCheckSubmission_one_pending_review_per_outcheck"
ON "DailyFlightOutCheckSubmission"("outCheckId")
WHERE "status" = 'PENDING_REVIEW';

CREATE UNIQUE INDEX "DailyFlightOutCheckSubmissionItem_submissionId_sourceWorkingItemId_key"
ON "DailyFlightOutCheckSubmissionItem"("submissionId", "sourceWorkingItemId");

CREATE INDEX "DailyFlightOutCheckSubmissionItem_submissionId_idx"
ON "DailyFlightOutCheckSubmissionItem"("submissionId");

CREATE INDEX "DailyFlightOutCheckSubmissionItem_submissionId_counterCodeSnapshot_checkItemCategorySnapshot_checkItemOrderSnapshot_idx"
ON "DailyFlightOutCheckSubmissionItem"(
    "submissionId",
    "counterCodeSnapshot",
    "checkItemCategorySnapshot",
    "checkItemOrderSnapshot"
);

ALTER TABLE "DailyFlightOutCheckSubmission"
ADD CONSTRAINT "DailyFlightOutCheckSubmission_outCheckId_fkey"
FOREIGN KEY ("outCheckId") REFERENCES "DailyFlightOutCheck"("id")
ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "DailyFlightOutCheckSubmission"
ADD CONSTRAINT "DailyFlightOutCheckSubmission_submittedById_fkey"
FOREIGN KEY ("submittedById") REFERENCES "User"("id")
ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "DailyFlightOutCheckSubmissionItem"
ADD CONSTRAINT "DailyFlightOutCheckSubmissionItem_submissionId_fkey"
FOREIGN KEY ("submissionId") REFERENCES "DailyFlightOutCheckSubmission"("id")
ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "DailyFlightOutCheckSubmissionItem"
ADD CONSTRAINT "DailyFlightOutCheckSubmissionItem_sourceWorkingItemId_fkey"
FOREIGN KEY ("sourceWorkingItemId") REFERENCES "DailyFlightOutCheckItemResult"("id")
ON DELETE SET NULL ON UPDATE CASCADE;

INSERT INTO "DailyFlightOutCheckSubmission" (
    "id",
    "outCheckId",
    "attemptNumber",
    "status",
    "submittedById",
    "submittedAt",
    "totalCount",
    "passCount",
    "failCount",
    "notApplicableCount",
    "createdAt"
)
SELECT
    substr(md5(outcheck.id || ':submission:1'), 1, 8) || '-' ||
    substr(md5(outcheck.id || ':submission:1'), 9, 4) || '-' ||
    substr(md5(outcheck.id || ':submission:1'), 13, 4) || '-' ||
    substr(md5(outcheck.id || ':submission:1'), 17, 4) || '-' ||
    substr(md5(outcheck.id || ':submission:1'), 21, 12),
    outcheck.id,
    1,
    'PENDING_REVIEW',
    outcheck."submittedById",
    outcheck."submittedAt",
    COUNT(item.id)::INTEGER,
    COUNT(item.id) FILTER (WHERE item.result = 'PASS')::INTEGER,
    COUNT(item.id) FILTER (WHERE item.result = 'FAIL')::INTEGER,
    COUNT(item.id) FILTER (WHERE item.result = 'NOT_APPLICABLE')::INTEGER,
    CURRENT_TIMESTAMP
FROM "DailyFlightOutCheck" AS outcheck
LEFT JOIN "DailyFlightOutCheckItemResult" AS item
    ON item."outCheckId" = outcheck.id
WHERE outcheck.status = 'SUBMITTED'
GROUP BY outcheck.id
ON CONFLICT ("outCheckId", "attemptNumber") DO NOTHING;

INSERT INTO "DailyFlightOutCheckSubmissionItem" (
    "id",
    "submissionId",
    "sourceWorkingItemId",
    "counterCodeSnapshot",
    "counterNameSnapshot",
    "checkItemNameSnapshot",
    "checkItemDescriptionSnapshot",
    "checkItemCategorySnapshot",
    "checkItemRequiredSnapshot",
    "checkItemOrderSnapshot",
    "result",
    "note",
    "createdAt"
)
SELECT
    substr(md5(item.id || ':submission-item:1'), 1, 8) || '-' ||
    substr(md5(item.id || ':submission-item:1'), 9, 4) || '-' ||
    substr(md5(item.id || ':submission-item:1'), 13, 4) || '-' ||
    substr(md5(item.id || ':submission-item:1'), 17, 4) || '-' ||
    substr(md5(item.id || ':submission-item:1'), 21, 12),
    submission.id,
    item.id,
    item."counterCodeSnapshot",
    item."counterNameSnapshot",
    item."checkItemNameSnapshot",
    item."checkItemDescriptionSnapshot",
    item."checkItemCategorySnapshot",
    item."checkItemRequiredSnapshot",
    item."checkItemOrderSnapshot",
    item.result,
    item.note,
    CURRENT_TIMESTAMP
FROM "DailyFlightOutCheckSubmission" AS submission
INNER JOIN "DailyFlightOutCheckItemResult" AS item
    ON item."outCheckId" = submission."outCheckId"
WHERE submission."attemptNumber" = 1
  AND submission.status = 'PENDING_REVIEW'
ON CONFLICT ("submissionId", "sourceWorkingItemId") DO NOTHING;
