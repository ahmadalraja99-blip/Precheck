import { Body, Controller, Get, Param, Post, Query, Res, UseGuards } from '@nestjs/common';
import { PermissionCode, ReportStatus, ReportType, Role } from '@prisma/client';
import { Response } from 'express';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Permissions } from '../common/decorators/permissions.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import { PaginationDto } from '../common/dto/pagination.dto';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { PermissionsGuard } from '../common/guards/permissions.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { AuthUser } from '../common/types/auth-user.type';
import { EmailReportDto } from './dto/report.dto';
import { ReportsService } from './reports.service';

@Controller('reports')
@UseGuards(JwtAuthGuard, RolesGuard, PermissionsGuard)
export class ReportsController {
  constructor(private readonly reports: ReportsService) {}

  @Get()
  @Roles(Role.SUPER_ADMIN, Role.ADMIN)
  @Permissions(PermissionCode.CAN_VIEW_REPORTS)
  list(@Query() query: PaginationDto & { type?: ReportType; status?: ReportStatus }) {
    return this.reports.list(query);
  }

  @Get(':id')
  @Roles(Role.SUPER_ADMIN, Role.ADMIN)
  @Permissions(PermissionCode.CAN_VIEW_REPORTS)
  find(@Param('id') id: string) {
    return this.reports.find(id);
  }

  @Get(':id/download')
  @Roles(Role.SUPER_ADMIN, Role.ADMIN)
  @Permissions(PermissionCode.CAN_EXPORT_REPORTS)
  async download(@Param('id') id: string, @Res() res: Response) {
    const file = await this.reports.downloadReport(id);
    res.setHeader('Content-Disposition', `attachment; filename="${file.filename}"`);
    res.end(file.data);
  }

  @Post(':id/email')
  @Roles(Role.SUPER_ADMIN, Role.ADMIN)
  @Permissions(PermissionCode.CAN_SEND_REPORT_EMAILS)
  email(@Param('id') id: string, @Body() dto: EmailReportDto, @CurrentUser() user: AuthUser) {
    return this.reports.emailReport(id, dto.recipients, user);
  }

  @Post('session/:sessionId/generate')
  @Roles(Role.SUPER_ADMIN, Role.ADMIN)
  @Permissions(PermissionCode.CAN_EXPORT_REPORTS)
  generateSession(@Param('sessionId') sessionId: string, @CurrentUser() user: AuthUser) {
    return this.reports.generateSessionFinalReport(sessionId, user.id);
  }
}
