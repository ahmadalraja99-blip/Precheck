import { Body, Controller, Get, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { IssueStatus, PermissionCode, Role } from '@prisma/client';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Permissions } from '../common/decorators/permissions.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import { PaginationDto } from '../common/dto/pagination.dto';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { PermissionsGuard } from '../common/guards/permissions.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { AuthUser } from '../common/types/auth-user.type';
import { AssignIssueDto, CreateIssueDto, ResolveIssueDto } from './dto/issue.dto';
import { IssuesService } from './issues.service';

@Controller('issues')
@UseGuards(JwtAuthGuard, RolesGuard, PermissionsGuard)
export class IssuesController {
  constructor(private readonly issues: IssuesService) {}

  @Get()
  @Roles(Role.SUPER_ADMIN, Role.ADMIN)
  @Permissions(PermissionCode.CAN_VIEW_ISSUES)
  list(@Query() query: PaginationDto & { status?: IssueStatus; sessionId?: string; counterId?: string }) {
    return this.issues.list(query);
  }

  @Get(':id')
  @Roles(Role.SUPER_ADMIN, Role.ADMIN)
  @Permissions(PermissionCode.CAN_VIEW_ISSUES)
  find(@Param('id') id: string) {
    return this.issues.find(id);
  }

  @Post()
  @Roles(Role.SUPER_ADMIN, Role.ADMIN)
  @Permissions(PermissionCode.CAN_RESOLVE_ISSUES)
  create(@Body() dto: CreateIssueDto, @CurrentUser() user: AuthUser) {
    return this.issues.create(dto, user);
  }

  @Patch(':id/assign')
  @Roles(Role.SUPER_ADMIN, Role.ADMIN)
  @Permissions(PermissionCode.CAN_RESOLVE_ISSUES)
  assign(@Param('id') id: string, @Body() dto: AssignIssueDto, @CurrentUser() user: AuthUser) {
    return this.issues.setInProgress(id, user, dto.note);
  }

  @Patch(':id/resolve')
  @Roles(Role.SUPER_ADMIN, Role.ADMIN)
  @Permissions(PermissionCode.CAN_RESOLVE_ISSUES)
  resolve(@Param('id') id: string, @Body() dto: ResolveIssueDto, @CurrentUser() user: AuthUser) {
    return this.issues.resolve(id, dto, user);
  }

  @Patch(':id/close')
  @Roles(Role.SUPER_ADMIN, Role.ADMIN)
  @Permissions(PermissionCode.CAN_RESOLVE_ISSUES)
  close(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.issues.close(id, user);
  }
}
