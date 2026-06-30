import { CounterReservationStatus } from '@prisma/client';
import { Transform } from 'class-transformer';
import { IsBoolean, IsDateString, IsEnum, IsOptional, IsUUID } from 'class-validator';
import { PaginationDto } from '../../common/dto/pagination.dto';

export class CounterReservationQueryDto extends PaginationDto {
  @IsOptional()
  @IsDateString()
  date?: string;

  @IsOptional()
  @IsUUID()
  companyId?: string;

  @IsOptional()
  @IsUUID()
  counterId?: string;

  @IsOptional()
  @IsUUID()
  movementCategoryId?: string;

  @IsOptional()
  @IsUUID()
  dailyCompanySessionId?: string;

  @IsOptional()
  @IsUUID()
  dailySessionFlightId?: string;

  @IsOptional()
  @IsEnum(CounterReservationStatus)
  status?: CounterReservationStatus;

  @IsOptional()
  @Transform(({ value }) => value === true || value === 'true')
  @IsBoolean()
  isCarryOver?: boolean;
}

export class CounterStatusMapQueryDto {
  @IsOptional()
  @IsDateString()
  at?: string;
}
