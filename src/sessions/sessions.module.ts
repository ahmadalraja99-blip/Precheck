import { Module } from '@nestjs/common';
import { CountersModule } from '../counters/counters.module';
import { SessionsController } from './sessions.controller';
import { SessionStatusMachine } from './session-status-machine.service';
import { SessionsService } from './sessions.service';

@Module({
  imports: [CountersModule],
  controllers: [SessionsController],
  providers: [SessionsService, SessionStatusMachine],
  exports: [SessionsService, SessionStatusMachine],
})
export class SessionsModule {}
