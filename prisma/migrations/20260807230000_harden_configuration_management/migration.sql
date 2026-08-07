ALTER TABLE "Counter" ADD COLUMN "isActive" BOOLEAN NOT NULL DEFAULT true;

ALTER TABLE "Device"
ADD COLUMN "manufacturer" TEXT,
ADD COLUMN "model" TEXT,
ADD COLUMN "firmwareVersion" TEXT;

CREATE UNIQUE INDEX "Device_assetTag_key" ON "Device"("assetTag");
CREATE UNIQUE INDEX "Device_serialNumber_key" ON "Device"("serialNumber");

CREATE TABLE "DeviceAssignmentHistory" (
  "id" TEXT NOT NULL,
  "deviceId" TEXT NOT NULL,
  "counterId" TEXT NOT NULL,
  "assignedById" TEXT NOT NULL,
  "assignedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "unassignedById" TEXT,
  "unassignedAt" TIMESTAMP(3),
  "reason" TEXT,
  CONSTRAINT "DeviceAssignmentHistory_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "DeviceAssignmentHistory_deviceId_fkey" FOREIGN KEY ("deviceId") REFERENCES "Device"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "DeviceAssignmentHistory_counterId_fkey" FOREIGN KEY ("counterId") REFERENCES "Counter"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE INDEX "DeviceAssignmentHistory_deviceId_unassignedAt_idx" ON "DeviceAssignmentHistory"("deviceId", "unassignedAt");
CREATE INDEX "DeviceAssignmentHistory_counterId_assignedAt_idx" ON "DeviceAssignmentHistory"("counterId", "assignedAt");

INSERT INTO "DeviceAssignmentHistory" ("id", "deviceId", "counterId", "assignedById", "assignedAt", "reason")
SELECT md5('initial-device-assignment:' || d."id"), d."id", d."counterId", 'SYSTEM_MIGRATION', d."createdAt", 'Existing assignment captured during lifecycle hardening'
FROM "Device" d;

CREATE TABLE "CounterStatusHistory" (
  "id" TEXT NOT NULL,
  "counterId" TEXT NOT NULL,
  "fromStatus" "CounterStatus" NOT NULL,
  "toStatus" "CounterStatus" NOT NULL,
  "reason" TEXT,
  "changedById" TEXT,
  "changedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "CounterStatusHistory_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "CounterStatusHistory_counterId_fkey" FOREIGN KEY ("counterId") REFERENCES "Counter"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE INDEX "CounterStatusHistory_counterId_changedAt_idx" ON "CounterStatusHistory"("counterId", "changedAt");
