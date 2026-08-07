import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { CounterReservationStatus, CounterStatus, Prisma, SessionStatus } from '@prisma/client';
import { AuditService } from '../audit/audit.service';
import { PaginationDto, paginate } from '../common/dto/pagination.dto';
import { AuthUser } from '../common/types/auth-user.type';
import { PrismaService } from '../prisma/prisma.service';
import { lockCounterRows } from '../common/database/counter-lock';
import { CounterStatusService } from './counter-status.service';
import { CreateCounterDto, UpdateCounterDto } from './dto/counter.dto';

@Injectable()
export class CountersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly counterStatus: CounterStatusService,
    private readonly audit: AuditService,
  ) {}

  private parseOptionalBoolean(value: unknown) {
    if (value === undefined || value === null || value === '') return undefined;
    if (value === true || value === 'true') return true;
    if (value === false || value === 'false') return false;
    throw new BadRequestException('isActive must be true or false');
  }

  async create(dto: CreateCounterDto, user: AuthUser) {
    try {
      const counter = await this.prisma.counter.create({ data: { ...dto, code: dto.code.toUpperCase() } });
      await this.audit.record({ user, action: 'CREATE_COUNTER', entityType: 'Counter', entityId: counter.id,
        metadata: { code: counter.code, status: counter.status, isActive: counter.isActive } });
      return counter;
    } catch (error) { this.rethrowUnique(error); }
  }

  async list(query: PaginationDto & { status?: CounterStatus; isActive?: boolean }) {
    const { skip, take, page, limit } = paginate(query);
    const where: Prisma.CounterWhereInput = {
      status: query.status,
      isActive: this.parseOptionalBoolean(query.isActive),
      OR: query.search ? [{ code: { contains: query.search, mode: 'insensitive' } }, { name: { contains: query.search, mode: 'insensitive' } }] : undefined,
    };
    const [items, total] = await this.prisma.$transaction([
      this.prisma.counter.findMany({ where, include: { devices: true,
        _count: { select: { counterReservations: { where: { status: { in: [CounterReservationStatus.SCHEDULED, CounterReservationStatus.ACTIVE] } } },
          operationalIssues: { where: { status: { in: ['OPEN', 'IN_PROGRESS'] } } } } } }, skip, take, orderBy: { code: 'asc' } }),
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
    try {
      return await this.prisma.$transaction(async (tx) => {
        await lockCounterRows(tx, [id]);
        const existing = await tx.counter.findUnique({ where: { id } });
        if (!existing) throw new NotFoundException('Counter not found');
        if (dto.isActive === false && existing.isActive) {
          const [operational, legacy] = await Promise.all([
            tx.counterReservation.count({ where: { counterId: id, status: { in: [CounterReservationStatus.SCHEDULED, CounterReservationStatus.ACTIVE] } } }),
            tx.sessionCounter.count({ where: { counterId: id, session: { status: { in: [SessionStatus.SCHEDULED, SessionStatus.PRECHECK_IN_PROGRESS,
              SessionStatus.PRECHECK_BLOCKED, SessionStatus.OPERATING, SessionStatus.OUTCHECK_IN_PROGRESS,
              SessionStatus.OUTCHECK_PENDING_APPROVAL, SessionStatus.OUTCHECK_REJECTED] } } } }),
          ]);
          if (operational || legacy) throw new ConflictException('Counter with an active reservation cannot be deactivated');
        }
        const counter = await tx.counter.update({ where: { id }, data: { ...dto,
          code: dto.code?.toUpperCase(), status: dto.isActive === false ? CounterStatus.OUT_OF_SERVICE : undefined } });
        if (existing.status !== counter.status) await tx.counterStatusHistory.create({ data: { counterId: id,
          fromStatus: existing.status, toStatus: counter.status, reason: 'Counter deactivated', changedById: user.id } });
        await this.audit.record({ user, action: dto.isActive === undefined ? 'UPDATE_COUNTER' : dto.isActive ? 'ACTIVATE_COUNTER' : 'DEACTIVATE_COUNTER',
          entityType: 'Counter', entityId: id, metadata: { previousCode: existing.code, code: counter.code,
            previousIsActive: existing.isActive, isActive: counter.isActive, previousStatus: existing.status, status: counter.status } }, tx);
        return counter;
      });
    } catch (error) { this.rethrowUnique(error); }
  }

  async updateStatus(id: string, status: CounterStatus, user: AuthUser, note?: string) {
    if (!note?.trim() || note.trim().length < 3) throw new ConflictException('A meaningful status-change reason is required');
    await this.prisma.$transaction(async (tx) => {
      await lockCounterRows(tx, [id]);
      const counter = await tx.counter.findUnique({ where: { id } });
      if (!counter) throw new NotFoundException('Counter not found');
      if (!counter.isActive && status !== CounterStatus.OUT_OF_SERVICE)
        throw new ConflictException('Inactive counters must be activated before restoration');
      await this.counterStatus.transitionMany([id], status, user, note, tx);
    });
    await this.counterStatus.publishCommitted([id], status);
    return this.find(id);
  }

  private rethrowUnique(error: unknown): never {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002')
      throw new ConflictException('Counter code already exists');
    throw error;
  }
}
