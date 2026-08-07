import { Controller, Get, Param, ParseUUIDPipe, Post, Query, UseGuards } from '@nestjs/common';
import { PermissionCode, Role } from '@prisma/client';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Permissions } from '../common/decorators/permissions.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { PermissionsGuard } from '../common/guards/permissions.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { AuthUser } from '../common/types/auth-user.type';
import { OperationalReportJobQueryDto } from './dto/operational-report-job-query.dto';
import { OperationalReportJobsService } from './operational-report-jobs.service';

@Controller('operational-report-jobs')
@UseGuards(JwtAuthGuard, RolesGuard, PermissionsGuard)
@Roles(Role.ADMIN, Role.SUPER_ADMIN)
@Permissions(PermissionCode.CAN_EXPORT_REPORTS)
export class OperationalReportJobsController {
  constructor(private readonly jobs: OperationalReportJobsService) {}
  @Get() list(@Query() query: OperationalReportJobQueryDto) { return this.jobs.list(query); }
  @Get(':jobId') find(@Param('jobId', new ParseUUIDPipe()) id: string) { return this.jobs.find(id); }
  @Post(':jobId/retry') retry(@Param('jobId', new ParseUUIDPipe()) id: string, @CurrentUser() user: AuthUser) {
    return this.jobs.retry(id, user);
  }
}
