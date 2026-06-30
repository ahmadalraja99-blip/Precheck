import { DailyCompanySessionStatus } from '@prisma/client';
import { IsDateString, IsEnum, IsOptional, IsUUID } from 'class-validator';
import { PaginationDto } from '../../common/dto/pagination.dto';

export class DailyCompanySessionQueryDto extends PaginationDto {
  @IsOptional()
  @IsDateString()
  date?: string;

  @IsOptional()
  @IsUUID()
  companyId?: string;

  @IsOptional()
  @IsUUID()
  movementCategoryId?: string;

  @IsOptional()
  @IsUUID()
  dailyDutyId?: string;

  @IsOptional()
  @IsEnum(DailyCompanySessionStatus)
  status?: DailyCompanySessionStatus;
}
