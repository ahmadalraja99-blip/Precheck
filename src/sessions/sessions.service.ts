import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { CounterStatus, NotificationType, Prisma, Role, SessionStatus } from '@prisma/client';
import { AuditService } from '../audit/audit.service';
import { PaginationDto, paginate } from '../common/dto/pagination.dto';
import { AuthUser } from '../common/types/auth-user.type';
import { safeUserSelect } from '../common/utils/sanitize-user';
import { CounterStatusService } from '../counters/counter-status.service';
import { NotificationsService } from '../notifications/notifications.service';
import { PrismaService } from '../prisma/prisma.service';
import { CreateSessionDto } from './dto/session.dto';
import { SessionStatusMachine } from './session-status-machine.service';

const activeStatuses: SessionStatus[] = [
  SessionStatus.SCHEDULED,
  SessionStatus.PRECHECK_IN_PROGRESS,
  SessionStatus.PRECHECK_BLOCKED,
  SessionStatus.OPERATING,
  SessionStatus.OUTCHECK_IN_PROGRESS,
  SessionStatus.OUTCHECK_PENDING_APPROVAL,
  SessionStatus.OUTCHECK_REJECTED,
];

type ChecklistTemplateMode = 'precheck' | 'outcheck';

@Injectable()
export class SessionsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly counterStatus: CounterStatusService,
    private readonly statusMachine: SessionStatusMachine,
    private readonly audit: AuditService,
    private readonly notifications: NotificationsService,
  ) {}

  private assertCompanyUserLinked(user: AuthUser) {
    if (user.role === Role.COMPANY_USER && !user.companyId) {
      throw new ForbiddenException('Company user is not linked to a company');
    }
  }

  async create(dto: CreateSessionDto, user: AuthUser) {
    const start = new Date(dto.plannedStartAt);
    const end = new Date(dto.plannedEndAt);
    if (start >= end) throw new BadRequestException('plannedStartAt must be before plannedEndAt');

    const session = await this.prisma.$transaction(async (tx) => {
      await this.counterStatus.assertAvailable(dto.counterIds, tx);
      const overlapping = await tx.sessionCounter.findFirst({
        where: {
          counterId: { in: dto.counterIds },
          session: {
            status: { in: activeStatuses },
            plannedStartAt: { lt: end },
            plannedEndAt: { gt: start },
          },
        },
      });
      if (overlapping) throw new ConflictException('Selected counter has an overlapping active session');
      const created = await tx.session.create({
        data: {
          companyId: dto.companyId,
          createdById: user.id,
          plannedStartAt: start,
          plannedEndAt: end,
          notes: dto.notes ?? dto.note,
          counters: { create: dto.counterIds.map((counterId) => ({ counterId })) },
        },
        include: { counters: { include: { counter: true } }, company: true },
      });
      await this.counterStatus.transitionMany(dto.counterIds, CounterStatus.RESERVED, user, 'Session created', tx);
      return created;
    });
    await this.audit.record({ user, action: 'CREATE_SESSION', entityType: 'Session', entityId: session.id });
    await this.notifications.create({
      title: 'Session created',
      message: `Session assigned to ${session.company.name}`,
      type: NotificationType.SESSION_CREATED,
      targetCompanyId: session.companyId,
      entityType: 'Session',
      entityId: session.id,
    });
    return session;
  }

  async list(query: PaginationDto & { status?: SessionStatus; companyId?: string; counterId?: string }, user: AuthUser) {
    this.assertCompanyUserLinked(user);
    const { skip, take, page, limit } = paginate(query);
    const companyId = user.role === Role.COMPANY_USER ? user.companyId! : query.companyId;
    const where: Prisma.SessionWhereInput = {
      status: query.status,
      companyId,
      counters: query.counterId ? { some: { counterId: query.counterId } } : undefined,
    };
    const [items, total] = await this.prisma.$transaction([
      this.prisma.session.findMany({
        where,
        include: { company: true, createdBy: { select: safeUserSelect }, counters: { include: { counter: true } }, issues: true },
        skip,
        take,
        orderBy: { plannedStartAt: 'desc' },
      }),
      this.prisma.session.count({ where }),
    ]);
    return { items, meta: { total, page, limit } };
  }

  async find(id: string, user?: AuthUser) {
    if (user) this.assertCompanyUserLinked(user);
    const session = await this.prisma.session.findUnique({
      where: { id },
      include: {
        company: true,
        createdBy: { select: safeUserSelect },
        counters: { include: { counter: { include: { devices: true } } } },
        preChecks: { include: { signedBy: { select: safeUserSelect }, results: { include: { checkItem: true, counter: true, device: true, issue: true } } } },
        outChecks: { include: { signedBy: { select: safeUserSelect }, results: { include: { checkItem: true, counter: true, device: true, issue: true } } } },
        issues: true,
        approvals: { include: { approvedBy: { select: safeUserSelect } } },
        reports: true,
      },
    });
    if (!session) throw new NotFoundException('Session not found');
    if (user?.role === Role.COMPANY_USER && session.companyId !== user.companyId) throw new ForbiddenException('Session belongs to another company');
    return session;
  }

  async checklistTemplate(sessionId: string, user: AuthUser, mode: ChecklistTemplateMode) {
    this.assertCompanyUserLinked(user);
    if (!([Role.COMPANY_USER, Role.SUPER_ADMIN] as Role[]).includes(user.role)) {
      throw new ForbiddenException('Checklist template is only available to company users');
    }

    const session = await this.prisma.session.findUnique({
      where: { id: sessionId },
      include: {
        counters: {
          include: {
            counter: {
              include: {
                devices: {
                  where: { isActive: true },
                  orderBy: { name: 'asc' },
                },
              },
            },
          },
          orderBy: { createdAt: 'asc' },
        },
      },
    });
    if (!session) throw new NotFoundException('Session not found');
    if (user.role === Role.COMPANY_USER && session.companyId !== user.companyId) {
      throw new ForbiddenException('Session belongs to another company');
    }

    const checkItems = await this.prisma.checkItem.findMany({
      where: { isActive: true },
      orderBy: [{ category: 'asc' }, { order: 'asc' }, { name: 'asc' }],
    });

    return {
      mode,
      session: {
        id: session.id,
        companyId: session.companyId,
        status: session.status,
        plannedStartAt: session.plannedStartAt,
        plannedEndAt: session.plannedEndAt,
      },
      counters: session.counters.map(({ counter }) => ({
        id: counter.id,
        code: counter.code,
        name: counter.name,
        status: counter.status,
        devices: counter.devices.map((device) => ({
          id: device.id,
          counterId: device.counterId,
          name: device.name,
          type: device.type,
          serialNumber: device.serialNumber,
          assetTag: device.assetTag,
          status: device.status,
        })),
      })),
      checkItems,
    };
  }

  async updateStatus(id: string, next: SessionStatus, data: Prisma.SessionUpdateInput = {}) {
    const session = await this.prisma.session.findUnique({ where: { id } });
    if (!session) throw new NotFoundException('Session not found');
    this.statusMachine.assert(session.status, next);
    return this.prisma.session.update({ where: { id }, data: { ...data, status: next } });
  }

  async cancel(id: string, user: AuthUser, reason?: string) {
    const session = await this.find(id, user);
    const counterIds = session.counters.map((row) => row.counterId);
    const cancelled = await this.prisma.$transaction(async (tx) => {
      this.statusMachine.assert(session.status, SessionStatus.CANCELLED);
      const updated = await tx.session.update({ where: { id }, data: { status: SessionStatus.CANCELLED, notes: reason ?? session.notes } });
      await this.counterStatus.transitionMany(counterIds, CounterStatus.AVAILABLE, user, 'Session cancelled', tx);
      return updated;
    });
    await this.audit.record({ user, action: 'CANCEL_SESSION', entityType: 'Session', entityId: id, note: reason });
    return cancelled;
  }
}
