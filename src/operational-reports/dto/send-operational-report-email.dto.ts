import { OperationalReportGenerationType } from '@prisma/client';
import { IsEnum, IsOptional, IsString, MaxLength } from 'class-validator';

export class SendOperationalReportEmailDto {
  @IsOptional() @IsEnum(OperationalReportGenerationType) generationType?: OperationalReportGenerationType;
  @IsOptional() @IsString() @MaxLength(50) templateVersion?: string;
}
