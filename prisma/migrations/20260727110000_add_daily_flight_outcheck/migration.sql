CREATE TYPE "DailyFlightOutCheckStatus" AS ENUM ('IN_PROGRESS', 'SUBMITTED');

CREATE TABLE "DailyFlightOutCheck" (
    "id" TEXT NOT NULL,
    "dailySessionFlightId" TEXT NOT NULL,
    "status" "DailyFlightOutCheckStatus" NOT NULL DEFAULT 'IN_PROGRESS',
    "startedById" TEXT NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "submittedById" TEXT,
    "submittedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DailyFlightOutCheck_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "DailyFlightOutCheckItemResult" (
    "id" TEXT NOT NULL,
    "outCheckId" TEXT NOT NULL,
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

    CONSTRAINT "DailyFlightOutCheckItemResult_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "DailyFlightOutCheck_dailySessionFlightId_key"
ON "DailyFlightOutCheck"("dailySessionFlightId");

CREATE INDEX "DailyFlightOutCheck_status_idx" ON "DailyFlightOutCheck"("status");
CREATE INDEX "DailyFlightOutCheck_startedById_idx" ON "DailyFlightOutCheck"("startedById");
CREATE INDEX "DailyFlightOutCheck_submittedById_idx" ON "DailyFlightOutCheck"("submittedById");

CREATE UNIQUE INDEX "DailyFlightOutCheckItemResult_outCheckId_counterReservationId_checkItemId_key"
ON "DailyFlightOutCheckItemResult"("outCheckId", "counterReservationId", "checkItemId");

CREATE INDEX "DailyFlightOutCheckItemResult_outCheckId_idx"
ON "DailyFlightOutCheckItemResult"("outCheckId");

CREATE INDEX "DailyFlightOutCheckItemResult_counterReservationId_idx"
ON "DailyFlightOutCheckItemResult"("counterReservationId");

CREATE INDEX "DailyFlightOutCheckItemResult_checkItemId_idx"
ON "DailyFlightOutCheckItemResult"("checkItemId");

CREATE INDEX "DailyFlightOutCheckItemResult_outCheckId_counterCodeSnapshot_checkItemCategorySnapshot_checkItemOrderSnapshot_idx"
ON "DailyFlightOutCheckItemResult"(
    "outCheckId",
    "counterCodeSnapshot",
    "checkItemCategorySnapshot",
    "checkItemOrderSnapshot"
);

ALTER TABLE "DailyFlightOutCheck"
ADD CONSTRAINT "DailyFlightOutCheck_dailySessionFlightId_fkey"
FOREIGN KEY ("dailySessionFlightId") REFERENCES "DailySessionFlight"("id")
ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "DailyFlightOutCheck"
ADD CONSTRAINT "DailyFlightOutCheck_startedById_fkey"
FOREIGN KEY ("startedById") REFERENCES "User"("id")
ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "DailyFlightOutCheck"
ADD CONSTRAINT "DailyFlightOutCheck_submittedById_fkey"
FOREIGN KEY ("submittedById") REFERENCES "User"("id")
ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "DailyFlightOutCheckItemResult"
ADD CONSTRAINT "DailyFlightOutCheckItemResult_outCheckId_fkey"
FOREIGN KEY ("outCheckId") REFERENCES "DailyFlightOutCheck"("id")
ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "DailyFlightOutCheckItemResult"
ADD CONSTRAINT "DailyFlightOutCheckItemResult_counterReservationId_fkey"
FOREIGN KEY ("counterReservationId") REFERENCES "CounterReservation"("id")
ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "DailyFlightOutCheckItemResult"
ADD CONSTRAINT "DailyFlightOutCheckItemResult_checkItemId_fkey"
FOREIGN KEY ("checkItemId") REFERENCES "CheckItem"("id")
ON DELETE SET NULL ON UPDATE CASCADE;
