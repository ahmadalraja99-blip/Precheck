import { Module } from '@nestjs/common';
import { CountersController } from './counters.controller';
import { CounterStatusService } from './counter-status.service';
import { CountersService } from './counters.service';

@Module({
  controllers: [CountersController],
  providers: [CountersService, CounterStatusService],
  exports: [CountersService, CounterStatusService],
})
export class CountersModule {}
