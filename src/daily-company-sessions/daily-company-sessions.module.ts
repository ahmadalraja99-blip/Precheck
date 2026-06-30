import { Module } from '@nestjs/common';
import { DailyCompanySessionsController } from './daily-company-sessions.controller';
import { DailyCompanySessionsService } from './daily-company-sessions.service';

@Module({
  controllers: [DailyCompanySessionsController],
  providers: [DailyCompanySessionsService],
  exports: [DailyCompanySessionsService],
})
export class DailyCompanySessionsModule {}
