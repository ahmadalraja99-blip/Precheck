import { Module } from '@nestjs/common';
import { CountersModule } from '../counters/counters.module';
import { SessionsModule } from '../sessions/sessions.module';
import { PrecheckController } from './precheck.controller';
import { PrecheckService } from './precheck.service';

@Module({
  imports: [SessionsModule, CountersModule],
  controllers: [PrecheckController],
  providers: [PrecheckService],
  exports: [PrecheckService],
})
export class PrecheckModule {}
