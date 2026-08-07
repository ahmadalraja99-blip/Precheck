CREATE UNIQUE INDEX "DailyDuty_single_open_global_key" ON "DailyDuty" ((1)) WHERE "status" = 'OPEN';
ALTER TABLE "DailySessionFlight"
  ADD COLUMN "carriedAt" TIMESTAMP(3),
  ADD COLUMN "carryOverReason" TEXT,
  ADD COLUMN "carryOverStatusSnapshot" "DailySessionFlightStatus",
  ADD COLUMN "carriedToMovementCategoryId" TEXT,
  ADD COLUMN "handoverAcceptedAt" TIMESTAMP(3),
  ADD COLUMN "handoverAcceptedById" TEXT;
CREATE INDEX "DailySessionFlight_carriedFromDailyDutyId_idx" ON "DailySessionFlight"("carriedFromDailyDutyId");
CREATE INDEX "DailySessionFlight_carriedToDailyDutyId_idx" ON "DailySessionFlight"("carriedToDailyDutyId");
ALTER TABLE "DailySessionFlight" ADD CONSTRAINT "DailySessionFlight_carriedToMovementCategoryId_fkey" FOREIGN KEY ("carriedToMovementCategoryId") REFERENCES "MovementCategory"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "DailySessionFlight" ADD CONSTRAINT "DailySessionFlight_handoverAcceptedById_fkey" FOREIGN KEY ("handoverAcceptedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
