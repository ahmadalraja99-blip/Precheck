import { Module } from '@nestjs/common';
import { DailyDutiesController } from './daily-duties.controller';
import { DailyDutiesService } from './daily-duties.service';

@Module({
  controllers: [DailyDutiesController],
  providers: [DailyDutiesService],
  exports: [DailyDutiesService],
})
export class DailyDutiesModule {}
