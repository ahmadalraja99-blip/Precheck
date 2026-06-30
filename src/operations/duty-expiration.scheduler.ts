import { Injectable } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { DutyExpirationService } from './duty-expiration.service';

@Injectable()
export class DutyExpirationScheduler {
  constructor(private readonly expiration: DutyExpirationService) {}

  @Cron(process.env.DUTY_EXPIRATION_CRON || '*/1 * * * *')
  expireDuties() {
    return this.expiration.expireDueDuties();
  }
}
