import { Body, Controller, Get, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { DailyDutyStatus, Role } from '@prisma/client';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { AuthUser } from '../common/types/auth-user.type';
import { DailyDutiesService } from './daily-duties.service';
import { ActivateDailyDutyDto } from './dto/activate-daily-duty.dto';
import { CloseDailyDutyDto } from './dto/close-daily-duty.dto';
import { DailyDutyQueryDto } from './dto/daily-duty-query.dto';

@Controller('daily-duties')
@UseGuards(JwtAuthGuard, RolesGuard)
export class DailyDutiesController {
  constructor(private readonly duties: DailyDutiesService) {}

  @Post('activate')
  @Roles(Role.MOVEMENT_SUPERVISOR, Role.ADMIN, Role.SUPER_ADMIN)
  activate(@Body() dto: ActivateDailyDutyDto, @CurrentUser() user: AuthUser) {
    return this.duties.activate(dto, user);
  }

  @Get('my/active')
  @Roles(Role.MOVEMENT_SUPERVISOR, Role.ADMIN, Role.SUPER_ADMIN)
  active(@CurrentUser() user: AuthUser) {
    return this.duties.active(user);
  }

  @Get('my/carry-over')
  @Roles(Role.MOVEMENT_SUPERVISOR, Role.ADMIN, Role.SUPER_ADMIN)
  carryOver(@CurrentUser() user: AuthUser) {
    return this.duties.carryOver(user);
  }

  @Get()
  @Roles(Role.MOVEMENT_SUPERVISOR, Role.ADMIN, Role.SUPER_ADMIN)
  list(@Query() query: DailyDutyQueryDto, @CurrentUser() user: AuthUser) {
    return this.duties.list(query, user);
  }

  @Get(':id')
  @Roles(Role.MOVEMENT_SUPERVISOR, Role.ADMIN, Role.SUPER_ADMIN)
  find(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.duties.find(id, user);
  }

  @Patch(':id/close')
  @Roles(Role.MOVEMENT_SUPERVISOR, Role.ADMIN, Role.SUPER_ADMIN)
  close(@Param('id') id: string, @Body() dto: CloseDailyDutyDto, @CurrentUser() user: AuthUser) {
    return this.duties.finish(id, DailyDutyStatus.CLOSED, dto, user);
  }

  @Patch(':id/cancel')
  @Roles(Role.MOVEMENT_SUPERVISOR, Role.ADMIN, Role.SUPER_ADMIN)
  cancel(@Param('id') id: string, @Body() dto: CloseDailyDutyDto, @CurrentUser() user: AuthUser) {
    return this.duties.finish(id, DailyDutyStatus.CANCELLED, dto, user);
  }
}
