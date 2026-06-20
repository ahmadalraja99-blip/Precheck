import { Module } from '@nestjs/common';
import { CountersModule } from '../counters/counters.module';
import { ReportsModule } from '../reports/reports.module';
import { SessionsModule } from '../sessions/sessions.module';
import { ApprovalsController } from './approvals.controller';
import { ApprovalsService } from './approvals.service';

@Module({
  imports: [SessionsModule, CountersModule, ReportsModule],
  controllers: [ApprovalsController],
  providers: [ApprovalsService],
})
export class ApprovalsModule {}
