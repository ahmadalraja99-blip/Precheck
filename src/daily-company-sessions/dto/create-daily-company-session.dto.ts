import { IsDateString, IsInt, IsOptional, IsString, IsUUID, Min } from 'class-validator';

export class CreateDailyCompanySessionDto {
  @IsUUID()
  dailyDutyId: string;

  @IsUUID()
  companyId: string;

  @IsDateString()
  date: string;

  @IsInt()
  @Min(0)
  plannedFlightsCount: number;

  @IsOptional()
  @IsString()
  notes?: string;
}
