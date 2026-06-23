import { IsArray, IsDateString, IsOptional, IsString, ArrayMinSize } from 'class-validator';

export class CreateSessionDto {
  @IsString()
  companyId: string;

  @IsArray()
  @ArrayMinSize(1)
  @IsString({ each: true })
  counterIds: string[];

  @IsDateString()
  plannedStartAt: string;

  @IsDateString()
  plannedEndAt: string;

  @IsOptional()
  @IsString()
  notes?: string;

  @IsOptional()
  @IsString()
  note?: string;
}

export class CancelSessionDto {
  @IsOptional()
  @IsString()
  reason?: string;
}
