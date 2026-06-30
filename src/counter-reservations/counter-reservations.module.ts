import { Module } from '@nestjs/common';
import { CounterReservationsController } from './counter-reservations.controller';
import { CounterReservationsService } from './counter-reservations.service';

@Module({
  controllers: [CounterReservationsController],
  providers: [CounterReservationsService],
  exports: [CounterReservationsService],
})
export class CounterReservationsModule {}
