import { DeviceStatus } from '@prisma/client';
import { Transform } from 'class-transformer';
import { IsBoolean, IsEnum, IsOptional, IsString, IsUUID, Length, Matches, ValidateIf } from 'class-validator';

const trim = ({ value }: { value: unknown }) => typeof value === 'string' ? value.trim() : value;

export class CreateDeviceDto {
  @IsString()
  @IsUUID()
  counterId: string;

  @IsString()
  @Transform(trim)
  @Length(1, 100)
  name: string;

  @IsString()
  @Transform(trim)
  @Length(1, 80)
  type: string;

  @IsOptional() @IsString() @Transform(trim) @Length(1, 100)
  manufacturer?: string;

  @IsOptional() @IsString() @Transform(trim) @Length(1, 100)
  model?: string;

  @IsOptional()
  @ValidateIf((_object, value) => value !== '')
  @IsString()
  @Transform(trim)
  @Matches(/^[A-Za-z0-9._\-/ ]{1,100}$/)
  serialNumber?: string;

  @IsOptional()
  @ValidateIf((_object, value) => value !== '')
  @IsString()
  @Transform(trim)
  @Matches(/^[A-Za-z0-9._\-/]{1,64}$/)
  assetTag?: string;

  @IsOptional() @IsString() @Transform(trim) @Length(1, 100)
  firmwareVersion?: string;

  @IsOptional()
  @IsEnum(DeviceStatus)
  status?: DeviceStatus;

  @IsOptional()
  @IsString()
  @Transform(trim)
  notes?: string;
}

export class UpdateDeviceDto {
  @IsOptional()
  @IsString()
  @IsUUID()
  counterId?: string;

  @IsOptional()
  @IsString()
  @Transform(trim)
  @Length(1, 100)
  name?: string;

  @IsOptional()
  @IsString()
  @Transform(trim)
  @Length(1, 80)
  type?: string;

  @IsOptional() @IsString() @Transform(trim) @Length(1, 100)
  manufacturer?: string;

  @IsOptional() @IsString() @Transform(trim) @Length(1, 100)
  model?: string;

  @IsOptional()
  @ValidateIf((_object, value) => value !== '')
  @IsString()
  @Transform(trim)
  @Matches(/^[A-Za-z0-9._\-/ ]{1,100}$/)
  serialNumber?: string;

  @IsOptional()
  @ValidateIf((_object, value) => value !== '')
  @IsString()
  @Transform(trim)
  @Matches(/^[A-Za-z0-9._\-/]{1,64}$/)
  assetTag?: string;

  @IsOptional() @IsString() @Transform(trim) @Length(1, 100)
  firmwareVersion?: string;

  @IsOptional()
  @IsEnum(DeviceStatus)
  status?: DeviceStatus;

  @IsOptional()
  @IsString()
  @Transform(trim)
  notes?: string;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}
