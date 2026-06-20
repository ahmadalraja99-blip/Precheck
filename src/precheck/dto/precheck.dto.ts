import { CheckResultValue } from '@prisma/client';
import { IsArray, IsEnum, IsOptional, IsString, ValidateNested, ArrayMinSize } from 'class-validator';
import { Type } from 'class-transformer';

export class CheckResultDto {
  @IsString()
  counterId: string;

  @IsOptional()
  @IsString()
  deviceId?: string;

  @IsString()
  checkItemId: string;

  @IsEnum(CheckResultValue)
  value: CheckResultValue;

  @IsOptional()
  @IsString()
  note?: string;
}

export class SubmitPreCheckDto {
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => CheckResultDto)
  results: CheckResultDto[];
}
