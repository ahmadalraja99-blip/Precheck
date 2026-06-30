import { IsOptional, IsString } from 'class-validator';

export class CloseDailyDutyDto {
  @IsOptional()
  @IsString()
  notes?: string;
}
