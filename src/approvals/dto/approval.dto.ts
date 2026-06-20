import { IsString } from 'class-validator';

export class RejectOutCheckDto {
  @IsString()
  rejectionReason: string;
}
