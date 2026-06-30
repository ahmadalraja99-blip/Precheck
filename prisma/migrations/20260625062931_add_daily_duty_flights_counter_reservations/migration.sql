-- CreateEnum
CREATE TYPE "DailyDutyStatus" AS ENUM ('OPEN', 'CLOSED', 'EXPIRED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "DailyCompanySessionStatus" AS ENUM ('SCHEDULED', 'OPEN', 'CLOSED', 'CANCELLED', 'CARRY_OVER');

-- CreateEnum
CREATE TYPE "FlightStatus" AS ENUM ('SCHEDULED', 'CHECKIN_OPEN', 'CHECKIN_CLOSED', 'DEPARTED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "FlightSource" AS ENUM ('MANUAL', 'IMPORTED');

-- CreateEnum
CREATE TYPE "DailySessionFlightStatus" AS ENUM ('SCHEDULED', 'PRECHECK_PENDING', 'PRECHECK_DONE', 'OPERATION', 'OUTCHECK_PENDING', 'CLOSED', 'CANCELLED', 'CARRY_OVER');

-- CreateEnum
CREATE TYPE "CounterReservationStatus" AS ENUM ('SCHEDULED', 'ACTIVE', 'RELEASED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "HandoverStatus" AS ENUM ('NONE', 'PENDING', 'ACCEPTED', 'COMPLETED');

-- CreateEnum
CREATE TYPE "OperationalReportFormat" AS ENUM ('PDF', 'EXCEL');

-- CreateEnum
CREATE TYPE "OperationalReportGenerationType" AS ENUM ('MANUAL', 'AUTOMATIC_DUTY_EXPIRATION', 'AUTOMATIC_FINAL_CLOSE');

-- AlterTable
ALTER TABLE "Company" ADD COLUMN     "logoPath" TEXT,
ADD COLUMN     "logoUrl" TEXT;

-- CreateTable
CREATE TABLE "MovementCategory" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MovementCategory_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MovementCategoryAssignment" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "movementCategoryId" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MovementCategoryAssignment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DailyDuty" (
    "id" TEXT NOT NULL,
    "movementCategoryId" TEXT NOT NULL,
    "movementSupervisorId" TEXT NOT NULL,
    "status" "DailyDutyStatus" NOT NULL DEFAULT 'OPEN',
    "activatedAt" TIMESTAMP(3) NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "closedAt" TIMESTAMP(3),
    "notes" TEXT,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DailyDuty_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DailyCompanySession" (
    "id" TEXT NOT NULL,
    "dailyDutyId" TEXT NOT NULL,
    "movementCategoryId" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "date" TIMESTAMP(3) NOT NULL,
    "plannedFlightsCount" INTEGER NOT NULL,
    "status" "DailyCompanySessionStatus" NOT NULL DEFAULT 'SCHEDULED',
    "openedAt" TIMESTAMP(3),
    "closedAt" TIMESTAMP(3),
    "notes" TEXT,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DailyCompanySession_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Flight" (
    "id" TEXT NOT NULL,
    "flightNumber" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "origin" TEXT,
    "destination" TEXT,
    "scheduledDepartureAt" TIMESTAMP(3) NOT NULL,
    "scheduledArrivalAt" TIMESTAMP(3),
    "aircraftType" TEXT,
    "status" "FlightStatus" NOT NULL DEFAULT 'SCHEDULED',
    "source" "FlightSource" NOT NULL DEFAULT 'MANUAL',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Flight_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DailySessionFlight" (
    "id" TEXT NOT NULL,
    "dailyCompanySessionId" TEXT NOT NULL,
    "flightId" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "movementCategoryId" TEXT NOT NULL,
    "checkInStartsAt" TIMESTAMP(3) NOT NULL,
    "checkInEndsAt" TIMESTAMP(3) NOT NULL,
    "status" "DailySessionFlightStatus" NOT NULL DEFAULT 'SCHEDULED',
    "notes" TEXT,
    "createdById" TEXT NOT NULL,
    "isCarryOver" BOOLEAN NOT NULL DEFAULT false,
    "handoverStatus" "HandoverStatus" NOT NULL DEFAULT 'NONE',
    "carriedFromDailyDutyId" TEXT,
    "carriedToDailyDutyId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DailySessionFlight_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CounterReservation" (
    "id" TEXT NOT NULL,
    "counterId" TEXT NOT NULL,
    "dailySessionFlightId" TEXT NOT NULL,
    "dailyCompanySessionId" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "movementCategoryId" TEXT NOT NULL,
    "reservedFrom" TIMESTAMP(3) NOT NULL,
    "reservedTo" TIMESTAMP(3) NOT NULL,
    "status" "CounterReservationStatus" NOT NULL DEFAULT 'SCHEDULED',
    "createdById" TEXT NOT NULL,
    "isCarryOver" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CounterReservation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FlightReport" (
    "id" TEXT NOT NULL,
    "dailySessionFlightId" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "movementCategoryId" TEXT NOT NULL,
    "generatedById" TEXT NOT NULL,
    "format" "OperationalReportFormat" NOT NULL,
    "generationType" "OperationalReportGenerationType" NOT NULL DEFAULT 'MANUAL',
    "filePath" TEXT,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FlightReport_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DailyCompanyReport" (
    "id" TEXT NOT NULL,
    "dailyCompanySessionId" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "movementCategoryId" TEXT NOT NULL,
    "generatedById" TEXT NOT NULL,
    "totalFlights" INTEGER NOT NULL,
    "format" "OperationalReportFormat" NOT NULL,
    "generationType" "OperationalReportGenerationType" NOT NULL DEFAULT 'MANUAL',
    "filePath" TEXT,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DailyCompanyReport_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "MovementCategory_code_key" ON "MovementCategory"("code");

-- CreateIndex
CREATE INDEX "MovementCategoryAssignment_userId_idx" ON "MovementCategoryAssignment"("userId");

-- CreateIndex
CREATE INDEX "MovementCategoryAssignment_movementCategoryId_idx" ON "MovementCategoryAssignment"("movementCategoryId");

-- CreateIndex
CREATE UNIQUE INDEX "MovementCategoryAssignment_userId_movementCategoryId_key" ON "MovementCategoryAssignment"("userId", "movementCategoryId");

-- CreateIndex
CREATE INDEX "DailyDuty_movementCategoryId_idx" ON "DailyDuty"("movementCategoryId");

-- CreateIndex
CREATE INDEX "DailyDuty_movementSupervisorId_idx" ON "DailyDuty"("movementSupervisorId");

-- CreateIndex
CREATE INDEX "DailyDuty_status_idx" ON "DailyDuty"("status");

-- CreateIndex
CREATE INDEX "DailyDuty_activatedAt_idx" ON "DailyDuty"("activatedAt");

-- CreateIndex
CREATE INDEX "DailyDuty_expiresAt_idx" ON "DailyDuty"("expiresAt");

-- CreateIndex
CREATE INDEX "DailyCompanySession_dailyDutyId_idx" ON "DailyCompanySession"("dailyDutyId");

-- CreateIndex
CREATE INDEX "DailyCompanySession_movementCategoryId_idx" ON "DailyCompanySession"("movementCategoryId");

-- CreateIndex
CREATE INDEX "DailyCompanySession_companyId_idx" ON "DailyCompanySession"("companyId");

-- CreateIndex
CREATE INDEX "DailyCompanySession_date_idx" ON "DailyCompanySession"("date");

-- CreateIndex
CREATE INDEX "DailyCompanySession_status_idx" ON "DailyCompanySession"("status");

-- CreateIndex
CREATE UNIQUE INDEX "DailyCompanySession_dailyDutyId_companyId_key" ON "DailyCompanySession"("dailyDutyId", "companyId");

-- CreateIndex
CREATE INDEX "Flight_companyId_idx" ON "Flight"("companyId");

-- CreateIndex
CREATE INDEX "Flight_flightNumber_idx" ON "Flight"("flightNumber");

-- CreateIndex
CREATE INDEX "Flight_scheduledDepartureAt_idx" ON "Flight"("scheduledDepartureAt");

-- CreateIndex
CREATE INDEX "Flight_status_idx" ON "Flight"("status");

-- CreateIndex
CREATE INDEX "DailySessionFlight_dailyCompanySessionId_idx" ON "DailySessionFlight"("dailyCompanySessionId");

-- CreateIndex
CREATE INDEX "DailySessionFlight_flightId_idx" ON "DailySessionFlight"("flightId");

-- CreateIndex
CREATE INDEX "DailySessionFlight_companyId_idx" ON "DailySessionFlight"("companyId");

-- CreateIndex
CREATE INDEX "DailySessionFlight_movementCategoryId_idx" ON "DailySessionFlight"("movementCategoryId");

-- CreateIndex
CREATE INDEX "DailySessionFlight_checkInStartsAt_idx" ON "DailySessionFlight"("checkInStartsAt");

-- CreateIndex
CREATE INDEX "DailySessionFlight_checkInEndsAt_idx" ON "DailySessionFlight"("checkInEndsAt");

-- CreateIndex
CREATE INDEX "DailySessionFlight_status_idx" ON "DailySessionFlight"("status");

-- CreateIndex
CREATE INDEX "DailySessionFlight_isCarryOver_idx" ON "DailySessionFlight"("isCarryOver");

-- CreateIndex
CREATE INDEX "DailySessionFlight_handoverStatus_idx" ON "DailySessionFlight"("handoverStatus");

-- CreateIndex
CREATE INDEX "CounterReservation_counterId_idx" ON "CounterReservation"("counterId");

-- CreateIndex
CREATE INDEX "CounterReservation_dailySessionFlightId_idx" ON "CounterReservation"("dailySessionFlightId");

-- CreateIndex
CREATE INDEX "CounterReservation_dailyCompanySessionId_idx" ON "CounterReservation"("dailyCompanySessionId");

-- CreateIndex
CREATE INDEX "CounterReservation_companyId_idx" ON "CounterReservation"("companyId");

-- CreateIndex
CREATE INDEX "CounterReservation_movementCategoryId_idx" ON "CounterReservation"("movementCategoryId");

-- CreateIndex
CREATE INDEX "CounterReservation_reservedFrom_idx" ON "CounterReservation"("reservedFrom");

-- CreateIndex
CREATE INDEX "CounterReservation_reservedTo_idx" ON "CounterReservation"("reservedTo");

-- CreateIndex
CREATE INDEX "CounterReservation_status_idx" ON "CounterReservation"("status");

-- CreateIndex
CREATE INDEX "CounterReservation_isCarryOver_idx" ON "CounterReservation"("isCarryOver");

-- CreateIndex
CREATE INDEX "FlightReport_dailySessionFlightId_idx" ON "FlightReport"("dailySessionFlightId");

-- CreateIndex
CREATE INDEX "FlightReport_companyId_idx" ON "FlightReport"("companyId");

-- CreateIndex
CREATE INDEX "FlightReport_movementCategoryId_idx" ON "FlightReport"("movementCategoryId");

-- CreateIndex
CREATE INDEX "FlightReport_generatedById_idx" ON "FlightReport"("generatedById");

-- CreateIndex
CREATE INDEX "DailyCompanyReport_dailyCompanySessionId_idx" ON "DailyCompanyReport"("dailyCompanySessionId");

-- CreateIndex
CREATE INDEX "DailyCompanyReport_companyId_idx" ON "DailyCompanyReport"("companyId");

-- CreateIndex
CREATE INDEX "DailyCompanyReport_movementCategoryId_idx" ON "DailyCompanyReport"("movementCategoryId");

-- CreateIndex
CREATE INDEX "DailyCompanyReport_generatedById_idx" ON "DailyCompanyReport"("generatedById");

-- AddForeignKey
ALTER TABLE "MovementCategoryAssignment" ADD CONSTRAINT "MovementCategoryAssignment_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MovementCategoryAssignment" ADD CONSTRAINT "MovementCategoryAssignment_movementCategoryId_fkey" FOREIGN KEY ("movementCategoryId") REFERENCES "MovementCategory"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DailyDuty" ADD CONSTRAINT "DailyDuty_movementCategoryId_fkey" FOREIGN KEY ("movementCategoryId") REFERENCES "MovementCategory"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DailyDuty" ADD CONSTRAINT "DailyDuty_movementSupervisorId_fkey" FOREIGN KEY ("movementSupervisorId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DailyDuty" ADD CONSTRAINT "DailyDuty_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DailyCompanySession" ADD CONSTRAINT "DailyCompanySession_dailyDutyId_fkey" FOREIGN KEY ("dailyDutyId") REFERENCES "DailyDuty"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DailyCompanySession" ADD CONSTRAINT "DailyCompanySession_movementCategoryId_fkey" FOREIGN KEY ("movementCategoryId") REFERENCES "MovementCategory"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DailyCompanySession" ADD CONSTRAINT "DailyCompanySession_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DailyCompanySession" ADD CONSTRAINT "DailyCompanySession_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Flight" ADD CONSTRAINT "Flight_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DailySessionFlight" ADD CONSTRAINT "DailySessionFlight_dailyCompanySessionId_fkey" FOREIGN KEY ("dailyCompanySessionId") REFERENCES "DailyCompanySession"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DailySessionFlight" ADD CONSTRAINT "DailySessionFlight_flightId_fkey" FOREIGN KEY ("flightId") REFERENCES "Flight"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DailySessionFlight" ADD CONSTRAINT "DailySessionFlight_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DailySessionFlight" ADD CONSTRAINT "DailySessionFlight_movementCategoryId_fkey" FOREIGN KEY ("movementCategoryId") REFERENCES "MovementCategory"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DailySessionFlight" ADD CONSTRAINT "DailySessionFlight_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CounterReservation" ADD CONSTRAINT "CounterReservation_counterId_fkey" FOREIGN KEY ("counterId") REFERENCES "Counter"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CounterReservation" ADD CONSTRAINT "CounterReservation_dailySessionFlightId_fkey" FOREIGN KEY ("dailySessionFlightId") REFERENCES "DailySessionFlight"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CounterReservation" ADD CONSTRAINT "CounterReservation_dailyCompanySessionId_fkey" FOREIGN KEY ("dailyCompanySessionId") REFERENCES "DailyCompanySession"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CounterReservation" ADD CONSTRAINT "CounterReservation_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CounterReservation" ADD CONSTRAINT "CounterReservation_movementCategoryId_fkey" FOREIGN KEY ("movementCategoryId") REFERENCES "MovementCategory"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CounterReservation" ADD CONSTRAINT "CounterReservation_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FlightReport" ADD CONSTRAINT "FlightReport_dailySessionFlightId_fkey" FOREIGN KEY ("dailySessionFlightId") REFERENCES "DailySessionFlight"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FlightReport" ADD CONSTRAINT "FlightReport_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FlightReport" ADD CONSTRAINT "FlightReport_movementCategoryId_fkey" FOREIGN KEY ("movementCategoryId") REFERENCES "MovementCategory"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FlightReport" ADD CONSTRAINT "FlightReport_generatedById_fkey" FOREIGN KEY ("generatedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DailyCompanyReport" ADD CONSTRAINT "DailyCompanyReport_dailyCompanySessionId_fkey" FOREIGN KEY ("dailyCompanySessionId") REFERENCES "DailyCompanySession"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DailyCompanyReport" ADD CONSTRAINT "DailyCompanyReport_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DailyCompanyReport" ADD CONSTRAINT "DailyCompanyReport_movementCategoryId_fkey" FOREIGN KEY ("movementCategoryId") REFERENCES "MovementCategory"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DailyCompanyReport" ADD CONSTRAINT "DailyCompanyReport_generatedById_fkey" FOREIGN KEY ("generatedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
