import { Body, Controller, Get, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { PermissionCode, Role } from '@prisma/client';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Permissions } from '../common/decorators/permissions.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import { PaginationDto } from '../common/dto/pagination.dto';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { PermissionsGuard } from '../common/guards/permissions.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { AuthUser } from '../common/types/auth-user.type';
import { CreateUserDto, UpdatePermissionsDto, UpdateUserDto } from './dto/user.dto';
import { UsersService } from './users.service';

@Controller('users')
@UseGuards(JwtAuthGuard, RolesGuard, PermissionsGuard)
export class UsersController {
  constructor(private readonly users: UsersService) {}

  @Post()
  @Roles(Role.SUPER_ADMIN)
  create(@Body() dto: CreateUserDto, @CurrentUser() user: AuthUser) {
    return this.users.create(dto, user);
  }

  @Get()
  @Roles(Role.SUPER_ADMIN, Role.ADMIN)
  @Permissions(PermissionCode.CAN_VIEW_USERS)
  list(@Query() query: PaginationDto & { role?: Role; companyId?: string }) {
    return this.users.list(query);
  }

  @Get(':id')
  @Roles(Role.SUPER_ADMIN, Role.ADMIN)
  @Permissions(PermissionCode.CAN_VIEW_USERS)
  find(@Param('id') id: string) {
    return this.users.findById(id);
  }

  @Patch(':id')
  @Roles(Role.SUPER_ADMIN)
  update(@Param('id') id: string, @Body() dto: UpdateUserDto, @CurrentUser() user: AuthUser) {
    return this.users.update(id, dto, user);
  }

  @Patch(':id/activate')
  @Roles(Role.SUPER_ADMIN)
  activate(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.users.activate(id, user);
  }

  @Patch(':id/deactivate')
  @Roles(Role.SUPER_ADMIN)
  deactivate(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.users.deactivate(id, user);
  }

  @Patch(':id/permissions')
  @Roles(Role.SUPER_ADMIN)
  permissions(@Param('id') id: string, @Body() dto: UpdatePermissionsDto, @CurrentUser() user: AuthUser) {
    return this.users.updatePermissions(id, dto, user);
  }
}
