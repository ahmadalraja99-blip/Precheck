-- Preserve cancelled company sessions and session flights as immutable history while
-- allowing a replacement active record for the same business key.
DROP INDEX IF EXISTS "DailyCompanySession_dailyDutyId_companyId_key";
DROP INDEX IF EXISTS "DailySessionFlight_dailyCompanySessionId_flightId_key";

CREATE UNIQUE INDEX "DailyCompanySession_active_dailyDutyId_companyId_key"
ON "DailyCompanySession"("dailyDutyId", "companyId")
WHERE "status" <> 'CANCELLED';

CREATE UNIQUE INDEX "DailySessionFlight_active_sessionId_flightId_key"
ON "DailySessionFlight"("dailyCompanySessionId", "flightId")
WHERE "status" <> 'CANCELLED';
