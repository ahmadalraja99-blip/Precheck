import { DailyFlightCheckResult } from '@prisma/client';
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

export class SaveOutCheckResultItemDto {
  @IsUUID()
  itemResultId: string;

  @IsEnum(DailyFlightCheckResult)
  result: DailyFlightCheckResult;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  note?: string;
}

export class SaveOutCheckResultsDto {
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => SaveOutCheckResultItemDto)
  items: SaveOutCheckResultItemDto[];
}
