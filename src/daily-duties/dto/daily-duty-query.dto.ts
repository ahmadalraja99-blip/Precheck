import { DailyDutyStatus } from '@prisma/client';
import { IsDateString, IsEnum, IsOptional, IsUUID } from 'class-validator';
import { PaginationDto } from '../../common/dto/pagination.dto';

export class DailyDutyQueryDto extends PaginationDto {
  @IsOptional()
  @IsUUID()
  movementCategoryId?: string;

  @IsOptional()
  @IsUUID()
  movementSupervisorId?: string;

  @IsOptional()
  @IsEnum(DailyDutyStatus)
  status?: DailyDutyStatus;

  @IsOptional()
  @IsDateString()
  date?: string;
}
