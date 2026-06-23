import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { PermissionCode, Role } from '@prisma/client';
import { Permissions } from '../common/decorators/permissions.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { PermissionsGuard } from '../common/guards/permissions.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { PaginationDto } from '../common/dto/pagination.dto';
import { AuditService } from './audit.service';

@Controller('audit-logs')
@UseGuards(JwtAuthGuard, RolesGuard, PermissionsGuard)
export class AuditController {
  constructor(private readonly audit: AuditService) {}

  @Get()
  @Roles(Role.SUPER_ADMIN, Role.ADMIN)
  @Permissions(PermissionCode.CAN_VIEW_AUDIT_LOGS)
  list(@Query() query: PaginationDto & { action?: string; entityType?: string }) {
    return this.audit.list(query);
  }
}
