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
import { CheckItemsService } from './check-items.service';
import { CreateCheckItemDto, UpdateCheckItemDto } from './dto/check-item.dto';

@Controller('check-items')
@UseGuards(JwtAuthGuard, RolesGuard, PermissionsGuard)
export class CheckItemsController {
  constructor(private readonly checkItems: CheckItemsService) {}

  @Post()
  @Roles(Role.SUPER_ADMIN)
  create(@Body() dto: CreateCheckItemDto, @CurrentUser() user: AuthUser) {
    return this.checkItems.create(dto, user);
  }

  @Get()
  @Roles(Role.SUPER_ADMIN, Role.ADMIN)
  @Permissions(PermissionCode.CAN_VIEW_DEVICES)
  list(@Query() query: PaginationDto & { category?: string; isActive?: boolean }) {
    return this.checkItems.list(query);
  }

  @Get(':id')
  @Roles(Role.SUPER_ADMIN, Role.ADMIN)
  @Permissions(PermissionCode.CAN_VIEW_DEVICES)
  find(@Param('id') id: string) {
    return this.checkItems.find(id);
  }

  @Patch(':id')
  @Roles(Role.SUPER_ADMIN)
  update(@Param('id') id: string, @Body() dto: UpdateCheckItemDto, @CurrentUser() user: AuthUser) {
    return this.checkItems.update(id, dto, user);
  }

  @Patch(':id/activate')
  @Roles(Role.SUPER_ADMIN)
  activate(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.checkItems.update(id, { isActive: true }, user);
  }

  @Patch(':id/deactivate')
  @Roles(Role.SUPER_ADMIN)
  deactivate(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.checkItems.update(id, { isActive: false }, user);
  }
}
