import { Body, Controller, Get, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { CounterReservationStatus, Role } from '@prisma/client';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { AuthUser } from '../common/types/auth-user.type';
import { CounterReservationsService } from './counter-reservations.service';
import {
  CounterReservationQueryDto,
  CounterStatusMapQueryDto,
} from './dto/counter-reservation-query.dto';
import { CreateCounterReservationDto } from './dto/create-counter-reservation.dto';

@Controller()
@UseGuards(JwtAuthGuard, RolesGuard)
export class CounterReservationsController {
  constructor(private readonly reservations: CounterReservationsService) {}

  @Post('session-flights/:sessionFlightId/counter-reservations')
  @Roles(Role.MOVEMENT_SUPERVISOR, Role.ADMIN, Role.SUPER_ADMIN)
  create(
    @Param('sessionFlightId') sessionFlightId: string,
    @Body() dto: CreateCounterReservationDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.reservations.create(sessionFlightId, dto, user);
  }

  @Get('counter-reservations/status-map')
  @Roles(Role.COMPANY_USER, Role.MOVEMENT_SUPERVISOR, Role.ADMIN, Role.SUPER_ADMIN)
  statusMap(@Query() query: CounterStatusMapQueryDto, @CurrentUser() user: AuthUser) {
    return this.reservations.statusMap(query, user);
  }

  @Get('counter-reservations')
  @Roles(Role.COMPANY_USER, Role.MOVEMENT_SUPERVISOR, Role.ADMIN, Role.SUPER_ADMIN)
  list(@Query() query: CounterReservationQueryDto, @CurrentUser() user: AuthUser) {
    return this.reservations.list(query, user);
  }

  @Get('session-flights/:sessionFlightId/counter-reservations')
  @Roles(Role.COMPANY_USER, Role.MOVEMENT_SUPERVISOR, Role.ADMIN, Role.SUPER_ADMIN)
  forFlight(@Param('sessionFlightId') sessionFlightId: string, @CurrentUser() user: AuthUser) {
    return this.reservations.forFlight(sessionFlightId, user);
  }

  @Patch('counter-reservations/:id/release')
  @Roles(Role.MOVEMENT_SUPERVISOR, Role.ADMIN, Role.SUPER_ADMIN)
  release(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.reservations.changeStatus(id, CounterReservationStatus.RELEASED, user);
  }

  @Patch('counter-reservations/:id/cancel')
  @Roles(Role.MOVEMENT_SUPERVISOR, Role.ADMIN, Role.SUPER_ADMIN)
  cancel(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.reservations.changeStatus(id, CounterReservationStatus.CANCELLED, user);
  }
}
