import { Module } from '@nestjs/common';
import { OperationalReportsController } from './operational-reports.controller';
import { OperationalReportsService } from './operational-reports.service';

@Module({
  controllers: [OperationalReportsController],
  providers: [OperationalReportsService],
  exports: [OperationalReportsService],
})
export class OperationalReportsModule {}
