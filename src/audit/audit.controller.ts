import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { PermissionCode } from '@prisma/client';
import { Permissions } from '../common/decorators/permissions.decorator';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { PermissionsGuard } from '../common/guards/permissions.guard';
import { PaginationDto } from '../common/dto/pagination.dto';
import { AuditService } from './audit.service';

@Controller('audit-logs')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class AuditController {
  constructor(private readonly audit: AuditService) {}

  @Get()
  @Permissions(PermissionCode.CAN_VIEW_AUDIT_LOGS)
  list(@Query() query: PaginationDto & { action?: string; entityType?: string }) {
    return this.audit.list(query);
  }
}
