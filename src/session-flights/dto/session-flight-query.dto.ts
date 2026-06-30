import { DailySessionFlightStatus, HandoverStatus } from '@prisma/client';
import { Transform, Type } from 'class-transformer';
import { IsBoolean, IsDateString, IsEnum, IsOptional, IsString, IsUUID } from 'class-validator';
import { PaginationDto } from '../../common/dto/pagination.dto';

export class SessionFlightQueryDto extends PaginationDto {
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
  @IsString()
  flightNumber?: string;

  @IsOptional()
  @IsEnum(DailySessionFlightStatus)
  status?: DailySessionFlightStatus;

  @IsOptional()
  @Transform(({ value }) => value === true || value === 'true')
  @IsBoolean()
  isCarryOver?: boolean;

  @IsOptional()
  @IsEnum(HandoverStatus)
  handoverStatus?: HandoverStatus;
}
