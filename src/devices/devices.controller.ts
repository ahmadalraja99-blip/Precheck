import { Body, Controller, Get, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { DeviceStatus, PermissionCode, Role } from '@prisma/client';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Permissions } from '../common/decorators/permissions.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import { PaginationDto } from '../common/dto/pagination.dto';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { PermissionsGuard } from '../common/guards/permissions.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { AuthUser } from '../common/types/auth-user.type';
import { CreateDeviceDto, UpdateDeviceDto } from './dto/device.dto';
import { DevicesService } from './devices.service';

@Controller('devices')
@UseGuards(JwtAuthGuard, RolesGuard, PermissionsGuard)
export class DevicesController {
  constructor(private readonly devices: DevicesService) {}

  @Post()
  @Roles(Role.SUPER_ADMIN)
  create(@Body() dto: CreateDeviceDto, @CurrentUser() user: AuthUser) {
    return this.devices.create(dto, user);
  }

  @Get()
  @Roles(Role.SUPER_ADMIN, Role.ADMIN)
  @Permissions(PermissionCode.CAN_VIEW_DEVICES)
  list(@Query() query: PaginationDto & { counterId?: string; status?: DeviceStatus }) {
    return this.devices.list(query);
  }

  @Get(':id')
  @Roles(Role.SUPER_ADMIN, Role.ADMIN)
  @Permissions(PermissionCode.CAN_VIEW_DEVICES)
  find(@Param('id') id: string) {
    return this.devices.find(id);
  }

  @Patch(':id')
  @Roles(Role.SUPER_ADMIN)
  update(@Param('id') id: string, @Body() dto: UpdateDeviceDto, @CurrentUser() user: AuthUser) {
    return this.devices.update(id, dto, user);
  }
}
