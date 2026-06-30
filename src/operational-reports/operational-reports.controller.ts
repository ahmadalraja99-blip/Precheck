import { Body, Controller, Get, Param, Post, Query, UseGuards } from '@nestjs/common';
import { Role } from '@prisma/client';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { AuthUser } from '../common/types/auth-user.type';
import { GenerateDailyCompanyReportDto } from './dto/generate-daily-company-report.dto';
import { GenerateFlightReportDto } from './dto/generate-flight-report.dto';
import { OperationalReportsService } from './operational-reports.service';
import { OperationalReportQueryDto } from './dto/operational-report-query.dto';

@Controller()
@UseGuards(JwtAuthGuard, RolesGuard)
export class OperationalReportsController {
  constructor(private readonly reports: OperationalReportsService) {}

  @Post('session-flights/:sessionFlightId/reports/generate')
  @Roles(Role.MOVEMENT_SUPERVISOR, Role.ADMIN, Role.SUPER_ADMIN)
  generateFlight(
    @Param('sessionFlightId') sessionFlightId: string,
    @Body() dto: GenerateFlightReportDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.reports.generateFlight(sessionFlightId, dto, user);
  }

  @Get('session-flights/:sessionFlightId/reports')
  @Roles(Role.COMPANY_USER, Role.MOVEMENT_SUPERVISOR, Role.ADMIN, Role.SUPER_ADMIN)
  flightReports(@Param('sessionFlightId') sessionFlightId: string, @CurrentUser() user: AuthUser) {
    return this.reports.flightReports(sessionFlightId, user);
  }

  @Post('daily-company-sessions/:sessionId/reports/generate')
  @Roles(Role.MOVEMENT_SUPERVISOR, Role.ADMIN, Role.SUPER_ADMIN)
  generateDaily(
    @Param('sessionId') sessionId: string,
    @Body() dto: GenerateDailyCompanyReportDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.reports.generateDaily(sessionId, dto, user);
  }

  @Get('daily-company-sessions/:sessionId/reports')
  @Roles(Role.COMPANY_USER, Role.MOVEMENT_SUPERVISOR, Role.ADMIN, Role.SUPER_ADMIN)
  dailyReports(@Param('sessionId') sessionId: string, @CurrentUser() user: AuthUser) {
    return this.reports.dailyReports(sessionId, user);
  }

  @Get('operational-reports/flights')
  @Roles(Role.COMPANY_USER, Role.MOVEMENT_SUPERVISOR, Role.ADMIN, Role.SUPER_ADMIN)
  listFlightReports(@Query() query: OperationalReportQueryDto, @CurrentUser() user: AuthUser) {
    return this.reports.listFlightReports(query, user);
  }

  @Get('operational-reports/daily')
  @Roles(Role.COMPANY_USER, Role.MOVEMENT_SUPERVISOR, Role.ADMIN, Role.SUPER_ADMIN)
  listDailyReports(@Query() query: OperationalReportQueryDto, @CurrentUser() user: AuthUser) {
    return this.reports.listDailyReports(query, user);
  }
}
