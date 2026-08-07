import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Query, Res, UseGuards } from '@nestjs/common';
import { PermissionCode, Role } from '@prisma/client';
import { Response } from 'express';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Permissions } from '../common/decorators/permissions.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { PermissionsGuard } from '../common/guards/permissions.guard';
import { AuthUser } from '../common/types/auth-user.type';
import { GenerateDailyCompanyReportDto } from './dto/generate-daily-company-report.dto';
import { GenerateFlightReportDto } from './dto/generate-flight-report.dto';
import { OperationalReportsService } from './operational-reports.service';
import { OperationalReportQueryDto } from './dto/operational-report-query.dto';

@Controller()
@UseGuards(JwtAuthGuard, RolesGuard, PermissionsGuard)
export class OperationalReportsController {
  constructor(private readonly reports: OperationalReportsService) {}

  @Post('session-flights/:sessionFlightId/reports/generate')
  @Roles(Role.MOVEMENT_SUPERVISOR, Role.ADMIN, Role.SUPER_ADMIN)
  @Permissions(PermissionCode.CAN_EXPORT_REPORTS)
  generateFlight(
    @Param('sessionFlightId', new ParseUUIDPipe()) sessionFlightId: string,
    @Body() dto: GenerateFlightReportDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.reports.generateFlight(sessionFlightId, dto, user);
  }

  @Get('session-flights/:sessionFlightId/reports')
  @Roles(Role.COMPANY_USER, Role.MOVEMENT_SUPERVISOR, Role.ADMIN, Role.SUPER_ADMIN)
  @Permissions(PermissionCode.CAN_VIEW_REPORTS)
  flightReports(@Param('sessionFlightId', new ParseUUIDPipe()) sessionFlightId: string, @CurrentUser() user: AuthUser) {
    return this.reports.flightReports(sessionFlightId, user);
  }

  @Get('session-flights/:sessionFlightId/reports/:reportId/download')
  @Roles(Role.COMPANY_USER, Role.MOVEMENT_SUPERVISOR, Role.ADMIN, Role.SUPER_ADMIN)
  @Permissions(PermissionCode.CAN_EXPORT_REPORTS)
  async downloadFlightReport(
    @Param('sessionFlightId', new ParseUUIDPipe()) sessionFlightId: string,
    @Param('reportId', new ParseUUIDPipe()) reportId: string,
    @CurrentUser() user: AuthUser,
    @Res() response: Response,
  ) {
    const file = await this.reports.downloadFlightReport(sessionFlightId, reportId, user);
    response.setHeader('Content-Type', file.mimeType);
    response.setHeader('Content-Length', file.data.length);
    response.setHeader('Content-Disposition', `attachment; filename="${file.filename}"`);
    response.end(file.data);
  }

  @Post('daily-company-sessions/:sessionId/reports/generate')
  @Roles(Role.MOVEMENT_SUPERVISOR, Role.ADMIN, Role.SUPER_ADMIN)
  @Permissions(PermissionCode.CAN_EXPORT_REPORTS)
  generateDaily(
    @Param('sessionId') sessionId: string,
    @Body() dto: GenerateDailyCompanyReportDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.reports.generateDaily(sessionId, dto, user);
  }

  @Get('daily-company-sessions/:sessionId/reports')
  @Roles(Role.COMPANY_USER, Role.MOVEMENT_SUPERVISOR, Role.ADMIN, Role.SUPER_ADMIN)
  @Permissions(PermissionCode.CAN_VIEW_REPORTS)
  dailyReports(@Param('sessionId') sessionId: string, @CurrentUser() user: AuthUser) {
    return this.reports.dailyReports(sessionId, user);
  }

  @Get('operational-reports/flights')
  @Roles(Role.COMPANY_USER, Role.MOVEMENT_SUPERVISOR, Role.ADMIN, Role.SUPER_ADMIN)
  @Permissions(PermissionCode.CAN_VIEW_REPORTS)
  listFlightReports(@Query() query: OperationalReportQueryDto, @CurrentUser() user: AuthUser) {
    return this.reports.listFlightReports(query, user);
  }

  @Get('operational-reports/daily')
  @Roles(Role.COMPANY_USER, Role.MOVEMENT_SUPERVISOR, Role.ADMIN, Role.SUPER_ADMIN)
  @Permissions(PermissionCode.CAN_VIEW_REPORTS)
  listDailyReports(@Query() query: OperationalReportQueryDto, @CurrentUser() user: AuthUser) {
    return this.reports.listDailyReports(query, user);
  }
}
