import { OperationalReportFormat, OperationalReportGenerationType, OperationalReportJobStatus } from '@prisma/client';
import { IsDateString, IsEnum, IsOptional, IsUUID } from 'class-validator';
import { PaginationDto } from '../../common/dto/pagination.dto';

export class OperationalReportJobQueryDto extends PaginationDto {
  @IsOptional() @IsEnum(OperationalReportJobStatus) status?: OperationalReportJobStatus;
  @IsOptional() @IsEnum(OperationalReportFormat) format?: OperationalReportFormat;
  @IsOptional() @IsUUID() flightId?: string;
  @IsOptional() @IsEnum(OperationalReportGenerationType) generationType?: OperationalReportGenerationType;
  @IsOptional() @IsDateString() createdFrom?: string;
  @IsOptional() @IsDateString() createdTo?: string;
}
