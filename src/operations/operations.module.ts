import { Global, Module } from '@nestjs/common';
import { DutyExpirationScheduler } from './duty-expiration.scheduler';
import { DutyExpirationService } from './duty-expiration.service';
import { OperationAccessService } from './operation-access.service';

@Global()
@Module({
  providers: [OperationAccessService, DutyExpirationService, DutyExpirationScheduler],
  exports: [OperationAccessService, DutyExpirationService],
})
export class OperationsModule {}
