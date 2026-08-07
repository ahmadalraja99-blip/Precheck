import { IsOptional, IsString, MaxLength, MinLength } from 'class-validator';
export class ResolveDailyFlightOperationalIssueDto {
  @IsString() @MinLength(3) @MaxLength(1000) resolutionNote: string;
  @IsOptional() @IsString() @MaxLength(1000) verificationNote?: string;
}
