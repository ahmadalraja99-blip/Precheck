import { FlightSource } from '@prisma/client';
import { IsDateString, IsEnum, IsOptional, IsString, IsUUID } from 'class-validator';

export class CreateFlightDto {
  @IsString()
  flightNumber: string;

  @IsUUID()
  companyId: string;

  @IsOptional()
  @IsString()
  origin?: string;

  @IsOptional()
  @IsString()
  destination?: string;

  @IsDateString()
  scheduledDepartureAt: string;

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
