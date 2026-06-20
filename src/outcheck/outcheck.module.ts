import { Module } from '@nestjs/common';
import { CountersModule } from '../counters/counters.module';
import { SessionsModule } from '../sessions/sessions.module';
import { OutcheckController } from './outcheck.controller';
import { OutcheckService } from './outcheck.service';

@Module({
  imports: [SessionsModule, CountersModule],
  controllers: [OutcheckController],
  providers: [OutcheckService],
  exports: [OutcheckService],
})
export class OutcheckModule {}
