import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Query, UseGuards } from '@nestjs/common';
import { PermissionCode, Role } from '@prisma/client';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Permissions } from '../common/decorators/permissions.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { PermissionsGuard } from '../common/guards/permissions.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { AuthUser } from '../common/types/auth-user.type';
import { OperationalReportEmailJobQueryDto } from './dto/operational-report-email-job-query.dto';
import { SendOperationalReportEmailDto } from './dto/send-operational-report-email.dto';
import { OperationalReportEmailJobsService } from './operational-report-email-jobs.service';

@Controller()
@UseGuards(JwtAuthGuard, RolesGuard, PermissionsGuard)
@Roles(Role.ADMIN, Role.SUPER_ADMIN)
@Permissions(PermissionCode.CAN_SEND_REPORT_EMAILS)
export class OperationalReportEmailJobsController {
  constructor(private readonly jobs: OperationalReportEmailJobsService) {}
  @Get('operational-report-email-jobs') list(@Query() query: OperationalReportEmailJobQueryDto) { return this.jobs.list(query); }
  @Get('operational-report-email-jobs/:jobId') find(@Param('jobId', new ParseUUIDPipe()) id: string) { return this.jobs.find(id); }
  @Post('operational-report-email-jobs/:jobId/retry') retry(@Param('jobId', new ParseUUIDPipe()) id: string, @CurrentUser() user: AuthUser) { return this.jobs.retry(id, user); }
  @Post('operational-report-email-jobs/:jobId/resend') resend(@Param('jobId', new ParseUUIDPipe()) id: string, @CurrentUser() user: AuthUser) { return this.jobs.resend(id, user); }
  @Post('session-flights/:flightId/reports/email') send(@Param('flightId', new ParseUUIDPipe()) id: string,
    @Body() dto: SendOperationalReportEmailDto, @CurrentUser() user: AuthUser) { return this.jobs.send(id, dto, user); }
}
