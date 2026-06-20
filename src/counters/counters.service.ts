import { Injectable, NotFoundException } from '@nestjs/common';
import { CounterStatus, Prisma, Role } from '@prisma/client';
import { AuditService } from '../audit/audit.service';
import { PaginationDto, paginate } from '../common/dto/pagination.dto';
import { AuthUser } from '../common/types/auth-user.type';
import { PrismaService } from '../prisma/prisma.service';
import { CounterStatusService } from './counter-status.service';
import { CreateCounterDto, UpdateCounterDto } from './dto/counter.dto';

@Injectable()
export class CountersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly counterStatus: CounterStatusService,
    private readonly audit: AuditService,
  ) {}

  async create(dto: CreateCounterDto, user: AuthUser) {
    const counter = await this.prisma.counter.create({ data: dto });
    await this.audit.record({ user, action: 'CREATE_COUNTER', entityType: 'Counter', entityId: counter.id });
    return counter;
  }

  async list(query: PaginationDto & { status?: CounterStatus }) {
    const { skip, take, page, limit } = paginate(query);
    const where: Prisma.CounterWhereInput = {
      status: query.status,
      OR: query.search ? [{ code: { contains: query.search, mode: 'insensitive' } }, { name: { contains: query.search, mode: 'insensitive' } }] : undefined,
    };
    const [items, total] = await this.prisma.$transaction([
      this.prisma.counter.findMany({ where, include: { devices: true }, skip, take, orderBy: { code: 'asc' } }),
      this.prisma.counter.count({ where }),
    ]);
    return { items, meta: { total, page, limit } };
  }

  statusMap() {
    return this.prisma.counter.groupBy({ by: ['status'], _count: { status: true } });
  }

  async find(id: string) {
    const counter = await this.prisma.counter.findUnique({ where: { id }, include: { devices: true } });
    if (!counter) throw new NotFoundException('Counter not found');
    return counter;
  }

  async update(id: string, dto: UpdateCounterDto, user: AuthUser) {
    await this.find(id);
    const counter = await this.prisma.counter.update({ where: { id }, data: dto });
    await this.audit.record({ user, action: 'UPDATE_COUNTER', entityType: 'Counter', entityId: id });
    return counter;
  }

  async updateStatus(id: string, status: CounterStatus, user: AuthUser, note?: string) {
    await this.find(id);
    await this.counterStatus.transitionMany([id], status, user, note);
    return this.find(id);
  }
}
