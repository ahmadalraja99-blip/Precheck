import { Body, Controller, Get, Param, Post, Query, Res, UseGuards } from '@nestjs/common';
import { PermissionCode, ReportStatus, ReportType } from '@prisma/client';
import { Response } from 'express';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Permissions } from '../common/decorators/permissions.decorator';
import { PaginationDto } from '../common/dto/pagination.dto';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { PermissionsGuard } from '../common/guards/permissions.guard';
import { AuthUser } from '../common/types/auth-user.type';
import { EmailReportDto } from './dto/report.dto';
import { ReportsService } from './reports.service';

@Controller('reports')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class ReportsController {
  constructor(private readonly reports: ReportsService) {}

  @Get()
  @Permissions(PermissionCode.CAN_VIEW_REPORTS)
  list(@Query() query: PaginationDto & { type?: ReportType; status?: ReportStatus }) {
    return this.reports.list(query);
  }

  @Get(':id')
  @Permissions(PermissionCode.CAN_VIEW_REPORTS)
  find(@Param('id') id: string) {
    return this.reports.find(id);
  }

  @Get(':id/download')
  @Permissions(PermissionCode.CAN_EXPORT_REPORTS)
  async download(@Param('id') id: string, @Res() res: Response) {
    const file = await this.reports.downloadReport(id);
    res.setHeader('Content-Disposition', `attachment; filename="${file.filename}"`);
    res.end(file.data);
  }

  @Post(':id/email')
  @Permissions(PermissionCode.CAN_SEND_REPORT_EMAILS)
  email(@Param('id') id: string, @Body() dto: EmailReportDto, @CurrentUser() user: AuthUser) {
    return this.reports.emailReport(id, dto.recipients, user);
  }

  @Post('session/:sessionId/generate')
  @Permissions(PermissionCode.CAN_EXPORT_REPORTS)
  generateSession(@Param('sessionId') sessionId: string, @CurrentUser() user: AuthUser) {
    return this.reports.generateSessionFinalReport(sessionId, user.id);
  }
}
