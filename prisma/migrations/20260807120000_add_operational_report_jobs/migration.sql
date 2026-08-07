CREATE TYPE "OperationalReportJobStatus" AS ENUM ('PENDING', 'PROCESSING', 'COMPLETED', 'FAILED');

CREATE TABLE "OperationalReportJob" (
    "id" TEXT NOT NULL,
    "dailySessionFlightId" TEXT NOT NULL,
    "format" "OperationalReportFormat" NOT NULL,
    "generationType" "OperationalReportGenerationType" NOT NULL,
    "templateVersion" TEXT NOT NULL,
    "status" "OperationalReportJobStatus" NOT NULL DEFAULT 'PENDING',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "maxAttempts" INTEGER NOT NULL DEFAULT 5,
    "nextAttemptAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lockedAt" TIMESTAMP(3),
    "lockedBy" TEXT,
    "lastError" TEXT,
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "OperationalReportJob_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "OperationalReportJob_dailySessionFlightId_format_generationType_templateVersion_key"
ON "OperationalReportJob"("dailySessionFlightId", "format", "generationType", "templateVersion");
CREATE INDEX "OperationalReportJob_status_nextAttemptAt_idx" ON "OperationalReportJob"("status", "nextAttemptAt");
CREATE INDEX "OperationalReportJob_lockedAt_idx" ON "OperationalReportJob"("lockedAt");
CREATE INDEX "OperationalReportJob_createdAt_idx" ON "OperationalReportJob"("createdAt");
ALTER TABLE "OperationalReportJob" ADD CONSTRAINT "OperationalReportJob_dailySessionFlightId_fkey"
FOREIGN KEY ("dailySessionFlightId") REFERENCES "DailySessionFlight"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
