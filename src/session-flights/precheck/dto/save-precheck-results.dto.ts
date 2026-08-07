import { Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsArray,
  IsEnum,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  ValidateNested,
} from 'class-validator';
import { DailyFlightCheckResult } from '@prisma/client';

export class SavePreCheckResultItemDto {
  @IsUUID()
  itemResultId: string;

  @IsEnum(DailyFlightCheckResult)
  result: DailyFlightCheckResult;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  note?: string;
}

export class SavePreCheckResultsDto {
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => SavePreCheckResultItemDto)
  items: SavePreCheckResultItemDto[];
}
