import { CounterStatus } from '@prisma/client';
import { IsEnum, IsOptional, IsString } from 'class-validator';

export class CreateCounterDto {
  @IsString()
  code: string;

  @IsString()
  name: string;

  @IsOptional()
  @IsString()
  notes?: string;
}

export class UpdateCounterDto {
  @IsOptional()
  @IsString()
  code?: string;

  @IsOptional()
  @IsString()
  name?: string;

  @IsOptional()
  @IsString()
  notes?: string;
}

export class UpdateCounterStatusDto {
  @IsEnum(CounterStatus)
  status: CounterStatus;

  @IsOptional()
  @IsString()
  note?: string;
}
