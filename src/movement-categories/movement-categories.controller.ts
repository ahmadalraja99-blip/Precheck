import { Body, Controller, Get, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { Role } from '@prisma/client';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { AuthUser } from '../common/types/auth-user.type';
import { CreateMovementCategoryDto } from './dto/create-movement-category.dto';
import { MovementCategoryQueryDto } from './dto/movement-category-query.dto';
import { UpdateMovementCategoryDto } from './dto/update-movement-category.dto';
import { MovementCategoriesService } from './movement-categories.service';

@Controller('movement-categories')
@UseGuards(JwtAuthGuard, RolesGuard)
export class MovementCategoriesController {
  constructor(private readonly categories: MovementCategoriesService) {}

  @Get('available')
  @Roles(Role.MOVEMENT_SUPERVISOR, Role.ADMIN, Role.SUPER_ADMIN)
  available(@CurrentUser() user: AuthUser) {
    return this.categories.available(user);
  }

  @Get()
  @Roles(Role.MOVEMENT_SUPERVISOR, Role.ADMIN, Role.SUPER_ADMIN)
  list(@Query() query: MovementCategoryQueryDto, @CurrentUser() user: AuthUser) {
    return this.categories.list(query, user);
  }

  @Get(':id')
  @Roles(Role.MOVEMENT_SUPERVISOR, Role.ADMIN, Role.SUPER_ADMIN)
  find(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.categories.find(id, user);
  }

  @Post()
  @Roles(Role.SUPER_ADMIN)
  create(@Body() dto: CreateMovementCategoryDto) {
    return this.categories.create(dto);
  }

  @Patch(':id')
  @Roles(Role.SUPER_ADMIN)
  update(@Param('id') id: string, @Body() dto: UpdateMovementCategoryDto) {
    return this.categories.update(id, dto);
  }
}
