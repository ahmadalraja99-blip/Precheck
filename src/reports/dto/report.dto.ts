import { IsArray, IsEmail } from 'class-validator';

export class EmailReportDto {
  @IsArray()
  @IsEmail({}, { each: true })
  recipients: string[];
}
