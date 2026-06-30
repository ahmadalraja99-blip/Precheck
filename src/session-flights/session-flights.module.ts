import { Module } from '@nestjs/common';
import { SessionFlightsController } from './session-flights.controller';
import { SessionFlightsService } from './session-flights.service';

@Module({
  controllers: [SessionFlightsController],
  providers: [SessionFlightsService],
  exports: [SessionFlightsService],
})
export class SessionFlightsModule {}
