import { Transform } from 'class-transformer';
import { IsBoolean, IsInt, IsOptional, IsString, Length, Min } from 'class-validator';

const trim = ({ value }: { value: unknown }) => typeof value === 'string' ? value.trim() : value;

export class CreateCheckItemDto {
  @IsString()
  @Transform(trim)
  @Length(1, 150)
  name: string;

  @IsOptional()
  @IsString()
  @Transform(trim)
  description?: string;

  @IsString()
  @Transform(trim)
  @Length(1, 80)
  category: string;

  @IsBoolean()
  isRequired: boolean;

  @IsOptional()
  @IsBoolean()
  allowsNotApplicable?: boolean;

  @IsOptional()
  @IsInt()
  @Min(0)
  order?: number;
}

export class UpdateCheckItemDto {
  @IsOptional()
  @IsString()
  @Transform(trim)
  @Length(1, 150)
  name?: string;

  @IsOptional()
  @IsString()
  @Transform(trim)
  description?: string;

  @IsOptional()
  @IsString()
  @Transform(trim)
  @Length(1, 80)
  category?: string;

  @IsOptional()
  @IsBoolean()
  isRequired?: boolean;

  @IsOptional()
  @IsBoolean()
  allowsNotApplicable?: boolean;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;

  @IsOptional()
  @IsInt()
  @Min(0)
  order?: number;
}
