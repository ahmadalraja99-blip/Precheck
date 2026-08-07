import { OperationalReportEmailJobStatus, OperationalReportGenerationType } from '@prisma/client';
import { IsDateString, IsEmail, IsEnum, IsOptional, IsUUID } from 'class-validator';
import { PaginationDto } from '../../common/dto/pagination.dto';

export class OperationalReportEmailJobQueryDto extends PaginationDto {
  @IsOptional() @IsEnum(OperationalReportEmailJobStatus) status?: OperationalReportEmailJobStatus;
  @IsOptional() @IsUUID() companyId?: string;
  @IsOptional() @IsUUID() flightId?: string;
  @IsOptional() @IsEnum(OperationalReportGenerationType) generationType?: OperationalReportGenerationType;
  @IsOptional() @IsDateString() createdFrom?: string;
  @IsOptional() @IsDateString() createdTo?: string;
  @IsOptional() @IsEmail() recipientEmail?: string;
}
