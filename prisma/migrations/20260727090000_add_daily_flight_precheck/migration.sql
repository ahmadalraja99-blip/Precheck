CREATE TYPE "DailyFlightPreCheckStatus" AS ENUM ('IN_PROGRESS', 'SUBMITTED');

CREATE TYPE "DailyFlightCheckResult" AS ENUM ('PASS', 'FAIL', 'NOT_APPLICABLE');

CREATE TABLE "DailyFlightPreCheck" (
    "id" TEXT NOT NULL,
    "dailySessionFlightId" TEXT NOT NULL,
    "status" "DailyFlightPreCheckStatus" NOT NULL DEFAULT 'IN_PROGRESS',
    "startedById" TEXT NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "submittedById" TEXT,
    "submittedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DailyFlightPreCheck_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "DailyFlightPreCheckItemResult" (
    "id" TEXT NOT NULL,
    "preCheckId" TEXT NOT NULL,
    "counterReservationId" TEXT,
    "checkItemId" TEXT,
    "counterCodeSnapshot" TEXT NOT NULL,
    "counterNameSnapshot" TEXT NOT NULL,
    "checkItemNameSnapshot" TEXT NOT NULL,
    "checkItemDescriptionSnapshot" TEXT,
    "checkItemCategorySnapshot" TEXT NOT NULL,
    "checkItemRequiredSnapshot" BOOLEAN NOT NULL,
    "checkItemOrderSnapshot" INTEGER NOT NULL,
    "result" "DailyFlightCheckResult",
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DailyFlightPreCheckItemResult_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "DailyFlightPreCheck_dailySessionFlightId_key"
ON "DailyFlightPreCheck"("dailySessionFlightId");

CREATE INDEX "DailyFlightPreCheck_status_idx" ON "DailyFlightPreCheck"("status");
CREATE INDEX "DailyFlightPreCheck_startedById_idx" ON "DailyFlightPreCheck"("startedById");
CREATE INDEX "DailyFlightPreCheck_submittedById_idx" ON "DailyFlightPreCheck"("submittedById");

CREATE UNIQUE INDEX "DailyFlightPreCheckItemResult_preCheckId_counterReservationId_checkItemId_key"
ON "DailyFlightPreCheckItemResult"("preCheckId", "counterReservationId", "checkItemId");

CREATE INDEX "DailyFlightPreCheckItemResult_preCheckId_idx"
ON "DailyFlightPreCheckItemResult"("preCheckId");

CREATE INDEX "DailyFlightPreCheckItemResult_counterReservationId_idx"
ON "DailyFlightPreCheckItemResult"("counterReservationId");

CREATE INDEX "DailyFlightPreCheckItemResult_checkItemId_idx"
ON "DailyFlightPreCheckItemResult"("checkItemId");

CREATE INDEX "DailyFlightPreCheckItemResult_preCheckId_counterCodeSnapshot_checkItemCategorySnapshot_checkItemOrderSnapshot_idx"
ON "DailyFlightPreCheckItemResult"(
    "preCheckId",
    "counterCodeSnapshot",
    "checkItemCategorySnapshot",
    "checkItemOrderSnapshot"
);

ALTER TABLE "DailyFlightPreCheck"
ADD CONSTRAINT "DailyFlightPreCheck_dailySessionFlightId_fkey"
FOREIGN KEY ("dailySessionFlightId") REFERENCES "DailySessionFlight"("id")
ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "DailyFlightPreCheck"
ADD CONSTRAINT "DailyFlightPreCheck_startedById_fkey"
FOREIGN KEY ("startedById") REFERENCES "User"("id")
ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "DailyFlightPreCheck"
ADD CONSTRAINT "DailyFlightPreCheck_submittedById_fkey"
FOREIGN KEY ("submittedById") REFERENCES "User"("id")
ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "DailyFlightPreCheckItemResult"
ADD CONSTRAINT "DailyFlightPreCheckItemResult_preCheckId_fkey"
FOREIGN KEY ("preCheckId") REFERENCES "DailyFlightPreCheck"("id")
ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "DailyFlightPreCheckItemResult"
ADD CONSTRAINT "DailyFlightPreCheckItemResult_counterReservationId_fkey"
FOREIGN KEY ("counterReservationId") REFERENCES "CounterReservation"("id")
ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "DailyFlightPreCheckItemResult"
ADD CONSTRAINT "DailyFlightPreCheckItemResult_checkItemId_fkey"
FOREIGN KEY ("checkItemId") REFERENCES "CheckItem"("id")
ON DELETE SET NULL ON UPDATE CASCADE;
