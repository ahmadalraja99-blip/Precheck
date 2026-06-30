import { ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma, Role } from '@prisma/client';
import { paginate } from '../common/dto/pagination.dto';
import { AuthUser } from '../common/types/auth-user.type';
import { PrismaService } from '../prisma/prisma.service';
import { CreateMovementCategoryDto } from './dto/create-movement-category.dto';
import { MovementCategoryQueryDto } from './dto/movement-category-query.dto';
import { UpdateMovementCategoryDto } from './dto/update-movement-category.dto';

@Injectable()
export class MovementCategoriesService {
  constructor(private readonly prisma: PrismaService) {}

  async available(user: AuthUser) {
    if (user.role === Role.COMPANY_USER) throw new ForbiddenException('Company users cannot activate movement categories');
    if (user.role === Role.MOVEMENT_SUPERVISOR) {
      const assignments = await this.prisma.movementCategoryAssignment.findMany({
        where: { userId: user.id, isActive: true, movementCategory: { isActive: true } },
        include: { movementCategory: true },
        orderBy: { movementCategory: { code: 'asc' } },
      });
      return assignments.map((item) => item.movementCategory);
    }
    return this.prisma.movementCategory.findMany({ where: { isActive: true }, orderBy: { code: 'asc' } });
  }

  async list(query: MovementCategoryQueryDto, user: AuthUser) {
    const { skip, take, page, limit } = paginate(query);
    const where: Prisma.MovementCategoryWhereInput = {
      isActive: query.isActive,
      assignments: user.role === Role.MOVEMENT_SUPERVISOR ? { some: { userId: user.id, isActive: true } } : undefined,
      OR: query.search
        ? [
            { code: { contains: query.search, mode: 'insensitive' } },
            { name: { contains: query.search, mode: 'insensitive' } },
          ]
        : undefined,
    };
    const [items, total] = await this.prisma.$transaction([
      this.prisma.movementCategory.findMany({ where, skip, take, orderBy: { code: 'asc' } }),
      this.prisma.movementCategory.count({ where }),
    ]);
    return { items, meta: { total, page, limit } };
  }

  async find(id: string, user?: AuthUser) {
    const item = await this.prisma.movementCategory.findUnique({ where: { id } });
    if (!item) throw new NotFoundException('Movement category not found');
    if (user?.role === Role.MOVEMENT_SUPERVISOR) {
      const assignment = await this.prisma.movementCategoryAssignment.findFirst({
        where: { userId: user.id, movementCategoryId: id, isActive: true },
      });
      if (!assignment) throw new ForbiddenException('Movement category is not assigned to this supervisor');
    }
    return item;
  }

  async create(dto: CreateMovementCategoryDto) {
    try {
      return await this.prisma.movementCategory.create({ data: { ...dto, code: dto.code.toUpperCase() } });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        throw new ConflictException('Movement category code already exists');
      }
      throw error;
    }
  }

  async update(id: string, dto: UpdateMovementCategoryDto) {
    await this.find(id);
    return this.prisma.movementCategory.update({
      where: { id },
      data: { ...dto, code: dto.code?.toUpperCase() },
    });
  }
}
