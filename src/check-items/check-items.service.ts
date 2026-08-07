import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { AuditService } from '../audit/audit.service';
import { PaginationDto, paginate } from '../common/dto/pagination.dto';
import { AuthUser } from '../common/types/auth-user.type';
import { PrismaService } from '../prisma/prisma.service';
import { CreateCheckItemDto, UpdateCheckItemDto } from './dto/check-item.dto';

@Injectable()
export class CheckItemsService {
  constructor(private readonly prisma: PrismaService, private readonly audit: AuditService) {}

  private parseOptionalBoolean(value: unknown) {
    if (value === undefined || value === null || value === '') return undefined;
    if (value === true || value === 'true') return true;
    if (value === false || value === 'false') return false;
    throw new BadRequestException('isActive must be true or false');
  }

  async create(dto: CreateCheckItemDto, user: AuthUser) {
    const item = await this.prisma.checkItem.create({ data: dto });
    await this.audit.record({ user, action: 'CREATE_CHECK_ITEM', entityType: 'CheckItem', entityId: item.id,
      metadata: { category: item.category, order: item.order, isRequired: item.isRequired,
        allowsNotApplicable: item.allowsNotApplicable, isActive: item.isActive } });
    return item;
  }

  async list(query: PaginationDto & { category?: string; isActive?: boolean }) {
    const { skip, take, page, limit } = paginate(query);
    const where: Prisma.CheckItemWhereInput = {
      category: query.category,
      isActive: this.parseOptionalBoolean(query.isActive),
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
    return this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT "id" FROM "CheckItem" WHERE "id"=${id} FOR UPDATE`;
      const existing = await tx.checkItem.findUnique({ where: { id } });
      if (!existing) throw new NotFoundException('Check item not found');
      const item = await tx.checkItem.update({ where: { id }, data: dto });
      const action = dto.isActive === undefined ? 'UPDATE_CHECK_ITEM' : dto.isActive ? 'ACTIVATE_CHECK_ITEM' : 'DEACTIVATE_CHECK_ITEM';
      await this.audit.record({ user, action, entityType: 'CheckItem', entityId: id,
        metadata: { previousCategory: existing.category, category: item.category, previousOrder: existing.order,
          order: item.order, previousRequired: existing.isRequired, isRequired: item.isRequired,
          previousAllowsNotApplicable: existing.allowsNotApplicable, allowsNotApplicable: item.allowsNotApplicable,
          previousIsActive: existing.isActive, isActive: item.isActive } }, tx);
      return item;
    });
  }

}
