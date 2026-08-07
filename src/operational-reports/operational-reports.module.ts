import { Module } from '@nestjs/common';
import { OperationalReportsController } from './operational-reports.controller';
import { OperationalReportsService } from './operational-reports.service';
import { OperationalFlightReportDataService } from './operational-flight-report-data.service';
import { OperationalFlightPdfService } from './operational-flight-pdf.service';
import { OperationalFlightExcelService } from './operational-flight-excel.service';
import { OperationalReportJobsProcessor } from './operational-report-jobs.processor';
import { OperationalReportJobsService } from './operational-report-jobs.service';
import { OperationalReportJobsController } from './operational-report-jobs.controller';
import { OperationalReportEmailPolicyService } from './operational-report-email-policy.service';
import { OperationalReportEmailJobsService } from './operational-report-email-jobs.service';
import { OperationalReportEmailJobsProcessor } from './operational-report-email-jobs.processor';
import { OperationalReportEmailJobsController } from './operational-report-email-jobs.controller';

@Module({
  controllers: [OperationalReportsController, OperationalReportJobsController, OperationalReportEmailJobsController],
  providers: [OperationalReportsService, OperationalFlightReportDataService, OperationalFlightPdfService, OperationalFlightExcelService, OperationalReportJobsProcessor, OperationalReportJobsService, OperationalReportEmailPolicyService, OperationalReportEmailJobsService, OperationalReportEmailJobsProcessor],
  exports: [OperationalReportsService],
})
export class OperationalReportsModule {}
