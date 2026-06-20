import { IssueSeverity, IssueType } from '@prisma/client';
import { IsEnum, IsOptional, IsString } from 'class-validator';

export class CreateIssueDto {
  @IsString()
  sessionId: string;

  @IsOptional()
  @IsString()
  counterId?: string;

  @IsOptional()
  @IsString()
  deviceId?: string;

  @IsOptional()
  @IsString()
  checkItemId?: string;

  @IsEnum(IssueType)
  type: IssueType;

  @IsEnum(IssueSeverity)
  severity: IssueSeverity;

  @IsString()
  title: string;

  @IsString()
  description: string;
}

export class AssignIssueDto {
  @IsString()
  note: string;
}

export class ResolveIssueDto {
  @IsString()
  resolutionNote: string;
}
