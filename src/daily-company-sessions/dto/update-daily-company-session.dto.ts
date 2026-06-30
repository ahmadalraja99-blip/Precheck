import { IsInt, IsOptional, IsString, Min } from 'class-validator';

export class UpdateDailyCompanySessionDto {
  @IsOptional()
  @IsInt()
  @Min(0)
  plannedFlightsCount?: number;

  @IsOptional()
  @IsString()
  notes?: string;
}
