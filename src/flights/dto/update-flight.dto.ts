import { FlightSource } from '@prisma/client';
import { IsDateString, IsEnum, IsOptional, IsString } from 'class-validator';

export class UpdateFlightDto {
  @IsOptional()
  @IsString()
  flightNumber?: string;

  @IsOptional()
  @IsString()
  origin?: string;

  @IsOptional()
  @IsString()
  destination?: string;

  @IsOptional()
  @IsDateString()
  scheduledDepartureAt?: string;

  @IsOptional()
  @IsDateString()
  scheduledArrivalAt?: string;

  @IsOptional()
  @IsString()
  aircraftType?: string;

  @IsOptional()
  @IsEnum(FlightSource)
  source?: FlightSource;
}
