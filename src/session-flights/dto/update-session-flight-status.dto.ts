import { DailySessionFlightStatus } from '@prisma/client';
import { IsEnum } from 'class-validator';

export class UpdateSessionFlightStatusDto {
  @IsEnum(DailySessionFlightStatus)
  status: DailySessionFlightStatus;
}
