import { Body, Controller, Get, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { DailyCompanySessionStatus, Role } from '@prisma/client';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { AuthUser } from '../common/types/auth-user.type';
import { DailyCompanySessionsService } from './daily-company-sessions.service';
import { CreateDailyCompanySessionDto } from './dto/create-daily-company-session.dto';
import { DailyCompanySessionQueryDto } from './dto/daily-company-session-query.dto';
import { GetOrCreateDailyCompanySessionDto } from './dto/get-or-create-daily-company-session.dto';
import { UpdateDailyCompanySessionDto } from './dto/update-daily-company-session.dto';

@Controller('daily-company-sessions')
@UseGuards(JwtAuthGuard, RolesGuard)
export class DailyCompanySessionsController {
  constructor(private readonly sessions: DailyCompanySessionsService) {}

  @Post()
  @Roles(Role.MOVEMENT_SUPERVISOR, Role.ADMIN, Role.SUPER_ADMIN)
  create(@Body() dto: CreateDailyCompanySessionDto, @CurrentUser() user: AuthUser) {
    return this.sessions.create(dto, user);
  }

  @Post('get-or-create')
  @Roles(Role.MOVEMENT_SUPERVISOR, Role.ADMIN, Role.SUPER_ADMIN)
  getOrCreate(@Body() dto: GetOrCreateDailyCompanySessionDto, @CurrentUser() user: AuthUser) {
    return this.sessions.getOrCreate(dto, user);
  }

  @Get()
  @Roles(Role.COMPANY_USER, Role.MOVEMENT_SUPERVISOR, Role.ADMIN, Role.SUPER_ADMIN)
  list(@Query() query: DailyCompanySessionQueryDto, @CurrentUser() user: AuthUser) {
    return this.sessions.list(query, user);
  }

  @Get(':id')
  @Roles(Role.COMPANY_USER, Role.MOVEMENT_SUPERVISOR, Role.ADMIN, Role.SUPER_ADMIN)
  find(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.sessions.find(id, user);
  }

  @Patch(':id')
  @Roles(Role.MOVEMENT_SUPERVISOR, Role.ADMIN, Role.SUPER_ADMIN)
  update(
    @Param('id') id: string,
    @Body() dto: UpdateDailyCompanySessionDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.sessions.update(id, dto, user);
  }

  @Patch(':id/open')
  @Roles(Role.MOVEMENT_SUPERVISOR, Role.ADMIN, Role.SUPER_ADMIN)
  open(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.sessions.changeStatus(id, DailyCompanySessionStatus.OPEN, user);
  }

  @Patch(':id/close')
  @Roles(Role.MOVEMENT_SUPERVISOR, Role.ADMIN, Role.SUPER_ADMIN)
  close(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.sessions.changeStatus(id, DailyCompanySessionStatus.CLOSED, user);
  }

  @Patch(':id/cancel')
  @Roles(Role.MOVEMENT_SUPERVISOR, Role.ADMIN, Role.SUPER_ADMIN)
  cancel(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.sessions.changeStatus(id, DailyCompanySessionStatus.CANCELLED, user);
  }
}
