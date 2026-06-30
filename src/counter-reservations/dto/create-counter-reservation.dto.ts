import { ArrayNotEmpty, ArrayUnique, IsArray, IsDateString, IsUUID } from 'class-validator';

export class CreateCounterReservationDto {
  @IsArray()
  @ArrayNotEmpty()
  @ArrayUnique()
  @IsUUID('4', { each: true })
  counterIds: string[];

  @IsDateString()
  reservedFrom: string;

  @IsDateString()
  reservedTo: string;
}
