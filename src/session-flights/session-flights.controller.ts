import { Body, Controller, Get, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { DailySessionFlightStatus, Role } from '@prisma/client';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { AuthUser } from '../common/types/auth-user.type';
import { AddSessionFlightDto } from './dto/add-session-flight.dto';
import { SessionFlightQueryDto } from './dto/session-flight-query.dto';
import { UpdateSessionFlightStatusDto } from './dto/update-session-flight-status.dto';
import { SessionFlightsService } from './session-flights.service';

@Controller()
@UseGuards(JwtAuthGuard, RolesGuard)
export class SessionFlightsController {
  constructor(private readonly sessionFlights: SessionFlightsService) {}

  @Post('daily-company-sessions/:sessionId/flights')
  @Roles(Role.MOVEMENT_SUPERVISOR, Role.ADMIN, Role.SUPER_ADMIN)
  add(
    @Param('sessionId') sessionId: string,
    @Body() dto: AddSessionFlightDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.sessionFlights.add(sessionId, dto, user);
  }

  @Get('daily-company-sessions/:sessionId/flights')
  @Roles(Role.COMPANY_USER, Role.MOVEMENT_SUPERVISOR, Role.ADMIN, Role.SUPER_ADMIN)
  listForSession(@Param('sessionId') sessionId: string, @CurrentUser() user: AuthUser) {
    return this.sessionFlights.listForSession(sessionId, user);
  }

  @Get('session-flights')
  @Roles(Role.COMPANY_USER, Role.MOVEMENT_SUPERVISOR, Role.ADMIN, Role.SUPER_ADMIN)
  list(@Query() query: SessionFlightQueryDto, @CurrentUser() user: AuthUser) {
    return this.sessionFlights.list(query, user);
  }

  @Get('session-flights/:id')
  @Roles(Role.COMPANY_USER, Role.MOVEMENT_SUPERVISOR, Role.ADMIN, Role.SUPER_ADMIN)
  find(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.sessionFlights.find(id, user);
  }

  @Patch('session-flights/:id/status')
  @Roles(Role.MOVEMENT_SUPERVISOR, Role.ADMIN, Role.SUPER_ADMIN)
  status(
    @Param('id') id: string,
    @Body() dto: UpdateSessionFlightStatusDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.sessionFlights.updateStatus(id, dto.status, user);
  }

  @Patch('session-flights/:id/cancel')
  @Roles(Role.MOVEMENT_SUPERVISOR, Role.ADMIN, Role.SUPER_ADMIN)
  cancel(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.sessionFlights.updateStatus(id, DailySessionFlightStatus.CANCELLED, user);
  }

  @Post('session-flights/:id/accept-carry-over')
  @Roles(Role.MOVEMENT_SUPERVISOR, Role.ADMIN, Role.SUPER_ADMIN)
  accept(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.sessionFlights.acceptCarryOver(id, user);
  }
}
