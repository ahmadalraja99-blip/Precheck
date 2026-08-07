import { CounterStatus } from '@prisma/client';
import { Transform } from 'class-transformer';
import { IsBoolean, IsEnum, IsOptional, IsString, Length } from 'class-validator';

const trim = ({ value }: { value: unknown }) => typeof value === 'string' ? value.trim() : value;

export class CreateCounterDto {
  @IsString()
  @Transform(trim)
  @Length(1, 32)
  code: string;

  @IsString()
  @Transform(trim)
  @Length(1, 100)
  name: string;

  @IsOptional()
  @IsString()
  @Transform(trim)
  notes?: string;
}

export class UpdateCounterDto {
  @IsOptional()
  @IsString()
  @Transform(trim)
  @Length(1, 32)
  code?: string;

  @IsOptional()
  @IsString()
  @Transform(trim)
  @Length(1, 100)
  name?: string;

  @IsOptional()
  @IsString()
  @Transform(trim)
  notes?: string;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

export class UpdateCounterStatusDto {
  @IsEnum(CounterStatus)
  status: CounterStatus;

  @IsOptional()
  @IsString()
  @Transform(trim)
  @Length(3, 500)
  note?: string;
}
