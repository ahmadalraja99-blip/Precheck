import { IsOptional, IsString } from 'class-validator';

export class CreateMovementCategoryDto {
  @IsString()
  code: string;

  @IsString()
  name: string;

  @IsOptional()
  @IsString()
  description?: string;
}
