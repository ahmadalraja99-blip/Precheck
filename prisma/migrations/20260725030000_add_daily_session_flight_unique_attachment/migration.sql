-- CreateIndex
CREATE UNIQUE INDEX "DailySessionFlight_dailyCompanySessionId_flightId_key" ON "DailySessionFlight"("dailyCompanySessionId", "flightId");
