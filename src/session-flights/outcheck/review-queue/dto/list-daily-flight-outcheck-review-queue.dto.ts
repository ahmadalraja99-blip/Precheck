import { Transform, Type } from "class-transformer";
import {
  IsDateString,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
} from "class-validator";

const emptyToUndefined = ({ value }: { value: unknown }) =>
  typeof value === "string" && value.trim() === "" ? undefined : value;

export class ListDailyFlightOutCheckReviewQueueDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page = 1;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit = 20;

  @IsOptional()
  @Transform(emptyToUndefined)
  @IsUUID()
  companyId?: string;

  @IsOptional()
  @Transform(emptyToUndefined)
  @IsUUID()
  movementCategoryId?: string;

  @IsOptional()
  @Transform(emptyToUndefined)
  @IsDateString()
  submittedFrom?: string;

  @IsOptional()
  @Transform(emptyToUndefined)
  @IsDateString()
  submittedTo?: string;

  @IsOptional()
  @Transform(({ value }: { value: unknown }) =>
    typeof value === "string" ? value.trim() || undefined : value,
  )
  @IsString()
  @MaxLength(100)
  flightNumber?: string;
}
