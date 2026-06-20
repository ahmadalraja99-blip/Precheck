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
import { CompaniesService } from './companies.service';
import { CreateCompanyDto, UpdateCompanyDto } from './dto/company.dto';

@Controller('companies')
@UseGuards(JwtAuthGuard, RolesGuard, PermissionsGuard)
export class CompaniesController {
  constructor(private readonly companies: CompaniesService) {}

  @Post()
  @Roles(Role.SUPER_ADMIN)
  create(@Body() dto: CreateCompanyDto, @CurrentUser() user: AuthUser) {
    return this.companies.create(dto, user);
  }

  @Get()
  @Permissions(PermissionCode.CAN_VIEW_COMPANIES)
  list(@Query() query: PaginationDto) {
    return this.companies.list(query);
  }

  @Get(':id')
  @Permissions(PermissionCode.CAN_VIEW_COMPANIES)
  find(@Param('id') id: string) {
    return this.companies.find(id);
  }

  @Patch(':id')
  @Roles(Role.SUPER_ADMIN)
  update(@Param('id') id: string, @Body() dto: UpdateCompanyDto, @CurrentUser() user: AuthUser) {
    return this.companies.update(id, dto, user);
  }

  @Patch(':id/activate')
  @Roles(Role.SUPER_ADMIN)
  activate(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.companies.update(id, { isActive: true }, user);
  }

  @Patch(':id/deactivate')
  @Roles(Role.SUPER_ADMIN)
  deactivate(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.companies.update(id, { isActive: false }, user);
  }
}
