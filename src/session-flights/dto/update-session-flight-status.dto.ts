import { DailySessionFlightStatus } from '@prisma/client';
import { Equals } from 'class-validator';

export class UpdateSessionFlightStatusDto {
  @Equals(DailySessionFlightStatus.CANCELLED)
  status: typeof DailySessionFlightStatus.CANCELLED;
}
