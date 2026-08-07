CREATE TYPE "OperationalReportEmailJobStatus" AS ENUM ('PENDING', 'PROCESSING', 'COMPLETED', 'FAILED', 'SKIPPED');
CREATE TYPE "OperationalReportEmailPurpose" AS ENUM ('FINAL_FLIGHT_REPORT');
CREATE TABLE "OperationalReportEmailJob" (
  "id" TEXT NOT NULL, "dailySessionFlightId" TEXT NOT NULL, "companyId" TEXT NOT NULL,
  "generationType" "OperationalReportGenerationType" NOT NULL,
  "emailPurpose" "OperationalReportEmailPurpose" NOT NULL DEFAULT 'FINAL_FLIGHT_REPORT',
  "templateVersion" TEXT NOT NULL, "deliveryNumber" INTEGER NOT NULL DEFAULT 1,
  "status" "OperationalReportEmailJobStatus" NOT NULL DEFAULT 'PENDING',
  "attempts" INTEGER NOT NULL DEFAULT 0, "maxAttempts" INTEGER NOT NULL DEFAULT 5,
  "nextAttemptAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "lockedAt" TIMESTAMP(3), "lockedBy" TEXT, "lastError" TEXT, "subject" TEXT,
  "recipientMetadata" JSONB, "attachmentMetadata" JSONB, "completedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "OperationalReportEmailJob_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "OperationalReportEmailJob_flight_generation_purpose_template_delivery_key"
ON "OperationalReportEmailJob"("dailySessionFlightId", "generationType", "emailPurpose", "templateVersion", "deliveryNumber");
CREATE INDEX "OperationalReportEmailJob_status_nextAttemptAt_idx" ON "OperationalReportEmailJob"("status", "nextAttemptAt");
CREATE INDEX "OperationalReportEmailJob_companyId_idx" ON "OperationalReportEmailJob"("companyId");
CREATE INDEX "OperationalReportEmailJob_lockedAt_idx" ON "OperationalReportEmailJob"("lockedAt");
CREATE INDEX "OperationalReportEmailJob_createdAt_idx" ON "OperationalReportEmailJob"("createdAt");
ALTER TABLE "OperationalReportEmailJob" ADD CONSTRAINT "OperationalReportEmailJob_flight_fkey" FOREIGN KEY ("dailySessionFlightId") REFERENCES "DailySessionFlight"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "OperationalReportEmailJob" ADD CONSTRAINT "OperationalReportEmailJob_company_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
