CREATE TYPE "OperationalReportStatus" AS ENUM ('PENDING', 'GENERATED', 'FAILED');

ALTER TABLE "FlightReport"
ADD COLUMN "status" "OperationalReportStatus" NOT NULL DEFAULT 'PENDING',
ADD COLUMN "errorMessage" TEXT,
ADD COLUMN "mimeType" TEXT,
ADD COLUMN "fileSize" INTEGER,
ADD COLUMN "checksum" TEXT,
ADD COLUMN "generatedAt" TIMESTAMP(3),
ADD COLUMN "templateVersion" TEXT NOT NULL DEFAULT '1.0';

CREATE UNIQUE INDEX "FlightReport_dailySessionFlightId_format_generationType_templateVersion_key"
ON "FlightReport"("dailySessionFlightId", "format", "generationType", "templateVersion");

INSERT INTO "RolePermission" ("id", "role", "permissionId")
SELECT gen_random_uuid()::text, role_name::"Role", p."id"
FROM unnest(ARRAY['COMPANY_USER', 'MOVEMENT_SUPERVISOR']) AS role_name
CROSS JOIN "Permission" p
WHERE p."code" = 'CAN_EXPORT_REPORTS'
ON CONFLICT ("role", "permissionId") DO NOTHING;
