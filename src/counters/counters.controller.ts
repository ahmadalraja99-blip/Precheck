import { Body, Controller, Get, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { CounterStatus, PermissionCode, Role } from '@prisma/client';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Permissions } from '../common/decorators/permissions.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import { PaginationDto } from '../common/dto/pagination.dto';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { PermissionsGuard } from '../common/guards/permissions.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { AuthUser } from '../common/types/auth-user.type';
import { CountersService } from './counters.service';
import { CreateCounterDto, UpdateCounterDto, UpdateCounterStatusDto } from './dto/counter.dto';

@Controller('counters')
@UseGuards(JwtAuthGuard, RolesGuard, PermissionsGuard)
export class CountersController {
  constructor(private readonly counters: CountersService) {}

  @Post()
  @Roles(Role.SUPER_ADMIN)
  create(@Body() dto: CreateCounterDto, @CurrentUser() user: AuthUser) {
    return this.counters.create(dto, user);
  }

  @Get()
  @Roles(Role.MOVEMENT_SUPERVISOR, Role.SUPER_ADMIN, Role.ADMIN)
  @Permissions(PermissionCode.CAN_VIEW_COUNTERS)
  list(@Query() query: PaginationDto & { status?: CounterStatus }) {
    return this.counters.list(query);
  }

  @Get('status-map')
  @Roles(Role.MOVEMENT_SUPERVISOR, Role.SUPER_ADMIN, Role.ADMIN)
  @Permissions(PermissionCode.CAN_VIEW_COUNTERS)
  statusMap() {
    return this.counters.statusMap();
  }

  @Get(':id')
  @Permissions(PermissionCode.CAN_VIEW_COUNTERS)
  find(@Param('id') id: string) {
    return this.counters.find(id);
  }

  @Patch(':id')
  @Roles(Role.SUPER_ADMIN)
  update(@Param('id') id: string, @Body() dto: UpdateCounterDto, @CurrentUser() user: AuthUser) {
    return this.counters.update(id, dto, user);
  }

  @Patch(':id/status')
  @Roles(Role.SUPER_ADMIN)
  status(@Param('id') id: string, @Body() dto: UpdateCounterStatusDto, @CurrentUser() user: AuthUser) {
    return this.counters.updateStatus(id, dto.status, user, dto.note);
  }
}
