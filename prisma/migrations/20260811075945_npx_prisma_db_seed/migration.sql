-- DropIndex
DROP INDEX "DailySessionFlight_carriedFromDailyDutyId_idx";

-- DropIndex
DROP INDEX "DailySessionFlight_carriedToDailyDutyId_idx";

-- RenameForeignKey
ALTER TABLE "OperationalReportEmailJob" RENAME CONSTRAINT "OperationalReportEmailJob_company_fkey" TO "OperationalReportEmailJob_companyId_fkey";

-- RenameForeignKey
ALTER TABLE "OperationalReportEmailJob" RENAME CONSTRAINT "OperationalReportEmailJob_flight_fkey" TO "OperationalReportEmailJob_dailySessionFlightId_fkey";

-- RenameIndex
ALTER INDEX "DailyCompanyReport_dailyCompanySessionId_format_generationType_" RENAME TO "DailyCompanyReport_dailyCompanySessionId_format_generationT_key";

-- RenameIndex
ALTER INDEX "DailyFlightOutCheckItemResult_outCheckId_counterCodeSnapshot_ch" RENAME TO "DailyFlightOutCheckItemResult_outCheckId_counterCodeSnapsho_idx";

-- RenameIndex
ALTER INDEX "DailyFlightOutCheckItemResult_outCheckId_counterReservationId_c" RENAME TO "DailyFlightOutCheckItemResult_outCheckId_counterReservation_key";

-- RenameIndex
ALTER INDEX "DailyFlightOutCheckSubmissionItem_submissionId_counterCodeSnaps" RENAME TO "DailyFlightOutCheckSubmissionItem_submissionId_counterCodeS_idx";

-- RenameIndex
ALTER INDEX "DailyFlightOutCheckSubmissionItem_submissionId_sourceWorkingIte" RENAME TO "DailyFlightOutCheckSubmissionItem_submissionId_sourceWorkin_key";

-- RenameIndex
ALTER INDEX "DailyFlightPreCheckItemResult_preCheckId_counterCodeSnapshot_ch" RENAME TO "DailyFlightPreCheckItemResult_preCheckId_counterCodeSnapsho_idx";

-- RenameIndex
ALTER INDEX "DailyFlightPreCheckItemResult_preCheckId_counterReservationId_c" RENAME TO "DailyFlightPreCheckItemResult_preCheckId_counterReservation_key";

-- RenameIndex
ALTER INDEX "FlightReport_dailySessionFlightId_format_generationType_templat" RENAME TO "FlightReport_dailySessionFlightId_format_generationType_tem_key";

-- RenameIndex
ALTER INDEX "OperationalReportEmailJob_flight_generation_purpose_template_de" RENAME TO "OperationalReportEmailJob_dailySessionFlightId_generationTy_key";

-- RenameIndex
ALTER INDEX "OperationalReportJob_dailySessionFlightId_format_generationType" RENAME TO "OperationalReportJob_dailySessionFlightId_format_generation_key";
