import { OperationalReportFormat } from '@prisma/client';
import { IsBoolean, IsEnum, IsOptional } from 'class-validator';

export class GenerateFlightReportDto {
  @IsEnum(OperationalReportFormat)
  format: OperationalReportFormat;

  @IsOptional()
  @IsBoolean()
  force?: boolean;
}
