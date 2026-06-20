import { Type } from 'class-transformer';
import { IsInt, IsOptional, IsString, Max, Min } from 'class-validator';

export class PaginationDto {
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
  @IsString()
  search?: string;
}

export function paginate(dto: PaginationDto) {
  const rawPage = Number(dto.page ?? 1);
  const rawLimit = Number(dto.limit ?? 20);

  const page = Number.isFinite(rawPage) && rawPage > 0 ? Math.floor(rawPage) : 1;

  const limit =
    Number.isFinite(rawLimit) && rawLimit > 0
      ? Math.min(Math.floor(rawLimit), 100)
      : 20;

  const skip = (page - 1) * limit;
  const take = limit;

  return {
    skip,
    take,
    page,
    limit,
  };
}
