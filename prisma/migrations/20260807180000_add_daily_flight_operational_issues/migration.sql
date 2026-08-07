ALTER TABLE "CheckItem" ADD COLUMN "allowsNotApplicable" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "DailyFlightPreCheckItemResult" ADD COLUMN "checkItemAllowsNotApplicableSnapshot" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "DailyFlightOutCheckItemResult" ADD COLUMN "checkItemAllowsNotApplicableSnapshot" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "DailyFlightOutCheckSubmissionItem" ADD COLUMN "checkItemAllowsNotApplicableSnapshot" BOOLEAN NOT NULL DEFAULT false;

CREATE TABLE "DailyFlightOperationalIssue" (
  "id" TEXT NOT NULL, "dailySessionFlightId" TEXT NOT NULL, "counterId" TEXT NOT NULL,
  "checkItemId" TEXT, "preCheckItemResultId" TEXT, "outCheckSubmissionItemId" TEXT,
  "attemptNumber" INTEGER, "counterCodeSnapshot" TEXT NOT NULL, "checkItemNameSnapshot" TEXT NOT NULL,
  "checkItemDescriptionSnapshot" TEXT, "result" "DailyFlightCheckResult" NOT NULL,
  "failureNote" TEXT NOT NULL, "status" "IssueStatus" NOT NULL DEFAULT 'OPEN', "rejectionReason" TEXT,
  "reportedById" TEXT NOT NULL, "reportedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "resolutionNote" TEXT, "verificationNote" TEXT, "resolvedById" TEXT, "resolvedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "DailyFlightOperationalIssue_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "DailyFlightOperationalIssue_preCheckItemResultId_key" ON "DailyFlightOperationalIssue"("preCheckItemResultId");
CREATE UNIQUE INDEX "DailyFlightOperationalIssue_outCheckSubmissionItemId_key" ON "DailyFlightOperationalIssue"("outCheckSubmissionItemId");
CREATE INDEX "DailyFlightOperationalIssue_dailySessionFlightId_status_idx" ON "DailyFlightOperationalIssue"("dailySessionFlightId", "status");
CREATE INDEX "DailyFlightOperationalIssue_counterId_status_idx" ON "DailyFlightOperationalIssue"("counterId", "status");
CREATE INDEX "DailyFlightOperationalIssue_attemptNumber_idx" ON "DailyFlightOperationalIssue"("attemptNumber");
ALTER TABLE "DailyFlightOperationalIssue" ADD CONSTRAINT "DailyFlightOperationalIssue_dailySessionFlightId_fkey" FOREIGN KEY ("dailySessionFlightId") REFERENCES "DailySessionFlight"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "DailyFlightOperationalIssue" ADD CONSTRAINT "DailyFlightOperationalIssue_counterId_fkey" FOREIGN KEY ("counterId") REFERENCES "Counter"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "DailyFlightOperationalIssue" ADD CONSTRAINT "DailyFlightOperationalIssue_checkItemId_fkey" FOREIGN KEY ("checkItemId") REFERENCES "CheckItem"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "DailyFlightOperationalIssue" ADD CONSTRAINT "DailyFlightOperationalIssue_preCheckItemResultId_fkey" FOREIGN KEY ("preCheckItemResultId") REFERENCES "DailyFlightPreCheckItemResult"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "DailyFlightOperationalIssue" ADD CONSTRAINT "DailyFlightOperationalIssue_outCheckSubmissionItemId_fkey" FOREIGN KEY ("outCheckSubmissionItemId") REFERENCES "DailyFlightOutCheckSubmissionItem"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "DailyFlightOperationalIssue" ADD CONSTRAINT "DailyFlightOperationalIssue_reportedById_fkey" FOREIGN KEY ("reportedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "DailyFlightOperationalIssue" ADD CONSTRAINT "DailyFlightOperationalIssue_resolvedById_fkey" FOREIGN KEY ("resolvedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
