import { IsUUID } from 'class-validator';

export class ActivateDailyDutyDto {
  @IsUUID()
  movementCategoryId: string;
}
