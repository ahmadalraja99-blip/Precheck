import { Type } from "class-transformer";
import { IsInt, IsUUID, Min } from "class-validator";

export class OutCheckSubmissionAttemptParamDto {
  @IsUUID()
  sessionFlightId: string;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  attemptNumber: number;
}
