import { Type } from 'class-transformer';
import { IsDateString, IsOptional, IsString, IsUUID, ValidateNested } from 'class-validator';
import { CreateFlightDto } from '../../flights/dto/create-flight.dto';

export class AddSessionFlightDto {
  @IsOptional()
  @IsUUID()
  flightId?: string;

  @IsOptional()
  @ValidateNested()
  @Type(() => CreateFlightDto)
  flight?: CreateFlightDto;

  @IsDateString()
  checkInStartsAt: string;

  @IsDateString()
  checkInEndsAt: string;

  @IsOptional()
  @IsString()
  notes?: string;
}
