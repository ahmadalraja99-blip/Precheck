import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { AuditService } from '../audit/audit.service';
import { PaginationDto, paginate } from '../common/dto/pagination.dto';
import { AuthUser } from '../common/types/auth-user.type';
import { PrismaService } from '../prisma/prisma.service';
import { CreateCheckItemDto, UpdateCheckItemDto } from './dto/check-item.dto';

@Injectable()
export class CheckItemsService {
  constructor(private readonly prisma: PrismaService, private readonly audit: AuditService) {}

  async create(dto: CreateCheckItemDto, user: AuthUser) {
    const item = await this.prisma.checkItem.create({ data: dto });
    await this.audit.record({ user, action: 'CREATE_CHECK_ITEM', entityType: 'CheckItem', entityId: item.id });
    return item;
  }

  async list(query: PaginationDto & { category?: string; isActive?: boolean }) {
    const { skip, take, page, limit } = paginate(query);
    const where: Prisma.CheckItemWhereInput = {
      category: query.category,
      isActive: query.isActive,
      OR: query.search ? [{ name: { contains: query.search, mode: 'insensitive' } }, { description: { contains: query.search, mode: 'insensitive' } }] : undefined,
    };
    const [items, total] = await this.prisma.$transaction([
      this.prisma.checkItem.findMany({ where, skip, take, orderBy: [{ category: 'asc' }, { order: 'asc' }] }),
      this.prisma.checkItem.count({ where }),
    ]);
    return { items, meta: { total, page, limit } };
  }

  async find(id: string) {
    const item = await this.prisma.checkItem.findUnique({ where: { id } });
    if (!item) throw new NotFoundException('Check item not found');
    return item;
  }

  async update(id: string, dto: UpdateCheckItemDto, user: AuthUser) {
    await this.find(id);
    const item = await this.prisma.checkItem.update({ where: { id }, data: dto });
    await this.audit.record({ user, action: 'UPDATE_CHECK_ITEM', entityType: 'CheckItem', entityId: id });
    return item;
  }
}
