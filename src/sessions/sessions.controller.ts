import { Body, Controller, Get, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { PermissionCode, Role, SessionStatus } from '@prisma/client';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Permissions } from '../common/decorators/permissions.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import { PaginationDto } from '../common/dto/pagination.dto';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { PermissionsGuard } from '../common/guards/permissions.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { AuthUser } from '../common/types/auth-user.type';
import { CancelSessionDto, CreateSessionDto } from './dto/session.dto';
import { SessionsService } from './sessions.service';

@Controller('sessions')
@UseGuards(JwtAuthGuard, RolesGuard, PermissionsGuard)
export class SessionsController {
  constructor(private readonly sessions: SessionsService) {}

  @Post()
  @Roles(Role.MOVEMENT_SUPERVISOR, Role.SUPER_ADMIN)
  create(@Body() dto: CreateSessionDto, @CurrentUser() user: AuthUser) {
    return this.sessions.create(dto, user);
  }

  @Get()
  @Roles(Role.COMPANY_USER, Role.MOVEMENT_SUPERVISOR, Role.SUPER_ADMIN, Role.ADMIN)
  @Permissions(PermissionCode.CAN_VIEW_SESSIONS)
  list(@Query() query: PaginationDto & { status?: SessionStatus; companyId?: string; counterId?: string }, @CurrentUser() user: AuthUser) {
    return this.sessions.list(query, user);
  }

  @Get(':sessionId/precheck/template')
  @Roles(Role.COMPANY_USER)
  precheckTemplate(@Param('sessionId') sessionId: string, @CurrentUser() user: AuthUser) {
    return this.sessions.checklistTemplate(sessionId, user, 'precheck');
  }

  @Get(':sessionId/outcheck/template')
  @Roles(Role.COMPANY_USER)
  outcheckTemplate(@Param('sessionId') sessionId: string, @CurrentUser() user: AuthUser) {
    return this.sessions.checklistTemplate(sessionId, user, 'outcheck');
  }

  @Get(':id')
  @Roles(Role.COMPANY_USER, Role.MOVEMENT_SUPERVISOR, Role.SUPER_ADMIN, Role.ADMIN)
  @Permissions(PermissionCode.CAN_VIEW_SESSIONS)
  find(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.sessions.find(id, user);
  }

  @Patch(':id/cancel')
  @Roles(Role.MOVEMENT_SUPERVISOR, Role.SUPER_ADMIN)
  cancel(@Param('id') id: string, @Body() dto: CancelSessionDto, @CurrentUser() user: AuthUser) {
    return this.sessions.cancel(id, user, dto.reason);
  }
}
