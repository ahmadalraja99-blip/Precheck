import { Body, Controller, Get, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { Role } from '@prisma/client';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { AuthUser } from '../common/types/auth-user.type';
import { CreateFlightDto } from './dto/create-flight.dto';
import { FlightQueryDto } from './dto/flight-query.dto';
import { UpdateFlightStatusDto } from './dto/update-flight-status.dto';
import { UpdateFlightDto } from './dto/update-flight.dto';
import { FlightsService } from './flights.service';

@Controller('flights')
@UseGuards(JwtAuthGuard, RolesGuard)
export class FlightsController {
  constructor(private readonly flights: FlightsService) {}

  @Post()
  @Roles(Role.MOVEMENT_SUPERVISOR, Role.ADMIN, Role.SUPER_ADMIN)
  create(@Body() dto: CreateFlightDto, @CurrentUser() user: AuthUser) {
    return this.flights.create(dto, user);
  }

  @Get()
  @Roles(Role.COMPANY_USER, Role.MOVEMENT_SUPERVISOR, Role.ADMIN, Role.SUPER_ADMIN)
  list(@Query() query: FlightQueryDto, @CurrentUser() user: AuthUser) {
    return this.flights.list(query, user);
  }

  @Get(':id')
  @Roles(Role.COMPANY_USER, Role.MOVEMENT_SUPERVISOR, Role.ADMIN, Role.SUPER_ADMIN)
  find(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.flights.find(id, user);
  }

  @Patch(':id')
  @Roles(Role.MOVEMENT_SUPERVISOR, Role.ADMIN, Role.SUPER_ADMIN)
  update(@Param('id') id: string, @Body() dto: UpdateFlightDto, @CurrentUser() user: AuthUser) {
    return this.flights.update(id, dto, user);
  }

  @Patch(':id/status')
  @Roles(Role.MOVEMENT_SUPERVISOR, Role.ADMIN, Role.SUPER_ADMIN)
  status(
    @Param('id') id: string,
    @Body() dto: UpdateFlightStatusDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.flights.updateStatus(id, dto, user);
  }
}
