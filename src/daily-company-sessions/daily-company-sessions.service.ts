import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException, Optional } from '@nestjs/common';
import { DailyCompanySessionStatus, DailySessionFlightStatus, Prisma, Role } from '@prisma/client';
import { paginate } from '../common/dto/pagination.dto';
import { AuthUser } from '../common/types/auth-user.type';
import { safeUserSelect } from '../common/utils/sanitize-user';
import { OperationAccessService } from '../operations/operation-access.service';
import { PrismaService } from '../prisma/prisma.service';
import { CreateDailyCompanySessionDto } from './dto/create-daily-company-session.dto';
import { DailyCompanySessionQueryDto } from './dto/daily-company-session-query.dto';
import { GetOrCreateDailyCompanySessionDto } from './dto/get-or-create-daily-company-session.dto';
import { UpdateDailyCompanySessionDto } from './dto/update-daily-company-session.dto';
import { AuditService } from '../audit/audit.service';
import { NotificationsGateway, REALTIME_EVENTS } from '../notifications/notifications.gateway';

const sessionInclude = {
  company: true,
  movementCategory: true,
  dailyDuty: { include: { movementCategory: true, movementSupervisor: { select: safeUserSelect } } },
  createdBy: { select: safeUserSelect },
} satisfies Prisma.DailyCompanySessionInclude;

@Injectable()
export class DailyCompanySessionsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly access: OperationAccessService,
    private readonly audit: AuditService,
    @Optional() private readonly realtime?: NotificationsGateway,
  ) {}

  async create(dto: CreateDailyCompanySessionDto, user: AuthUser) {
    this.assertCanCreateSession(user);
    this.assertPlannedFlightsCount(dto.plannedFlightsCount);
    this.access.assertCompanyScope(dto.companyId, user);
    const duty = await this.access.assertActiveDuty(dto.dailyDutyId, user);
    const company = await this.prisma.company.findUnique({ where: { id: dto.companyId } });
    if (!company?.isActive) throw new NotFoundException('Active company not found');
    try {
      const created = await this.prisma.dailyCompanySession.create({
        data: {
          dailyDutyId: duty.id,
          movementCategoryId: duty.movementCategoryId,
          companyId: dto.companyId,
          date: new Date(dto.date),
          plannedFlightsCount: dto.plannedFlightsCount,
          notes: dto.notes,
          createdById: user.id,
        },
        include: sessionInclude,
      });
      await this.audit.record({ user, action: 'CREATE_DAILY_COMPANY_SESSION', entityType: 'DailyCompanySession',
        entityId: created.id, metadata: { dailyDutyId: created.dailyDutyId, companyId: created.companyId,
          movementCategoryId: created.movementCategoryId, plannedFlightsCount: created.plannedFlightsCount } });
      this.publish(REALTIME_EVENTS.COMPANY_SESSION_CREATED, created);
      return created;
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        throw new ConflictException('A daily company session already exists for this company and duty');
      }
      throw error;
    }
  }

  async getOrCreate(dto: GetOrCreateDailyCompanySessionDto, user: AuthUser) {
    this.assertCanCreateSession(user);
    this.assertPlannedFlightsCount(dto.plannedFlightsCount);
    this.access.assertCompanyScope(dto.companyId, user);
    const duty = await this.access.assertActiveDuty(dto.dailyDutyId, user);
    const company = await this.prisma.company.findUnique({ where: { id: dto.companyId } });
    if (!company?.isActive) throw new NotFoundException('Active company not found');

    const where = {
      dailyDutyId: duty.id,
      companyId: dto.companyId,
      status: { not: DailyCompanySessionStatus.CANCELLED },
    } satisfies Prisma.DailyCompanySessionWhereInput;

    const existing = await this.prisma.dailyCompanySession.findFirst({
      where,
      include: sessionInclude,
    });
    if (existing) return { created: false, session: existing };

    try {
      const session = await this.prisma.dailyCompanySession.create({
        data: {
          dailyDutyId: duty.id,
          movementCategoryId: duty.movementCategoryId,
          companyId: dto.companyId,
          date: new Date(dto.date),
          plannedFlightsCount: dto.plannedFlightsCount,
          status: DailyCompanySessionStatus.SCHEDULED,
          notes: dto.notes,
          createdById: user.id,
        },
        include: sessionInclude,
      });
      await this.audit.record({ user, action: 'CREATE_DAILY_COMPANY_SESSION', entityType: 'DailyCompanySession',
        entityId: session.id, metadata: { dailyDutyId: session.dailyDutyId, companyId: session.companyId,
          movementCategoryId: session.movementCategoryId, plannedFlightsCount: session.plannedFlightsCount } });
      this.publish(REALTIME_EVENTS.COMPANY_SESSION_CREATED, session);
      return { created: true, session };
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        const session = await this.prisma.dailyCompanySession.findFirst({
          where,
          include: sessionInclude,
        });
        if (session) return { created: false, session };
      }
      throw error;
    }
  }

  async list(query: DailyCompanySessionQueryDto, user: AuthUser) {
    const { skip, take, page, limit } = paginate(query);
    const day = query.date ? new Date(query.date) : undefined;
    const nextDay = day ? new Date(day.getTime() + 24 * 60 * 60 * 1000) : undefined;
    const where: Prisma.DailyCompanySessionWhereInput = {
      companyId: user.role === Role.COMPANY_USER ? user.companyId ?? '__unlinked__' : query.companyId,
      movementCategoryId: query.movementCategoryId,
      dailyDutyId: query.dailyDutyId,
      status: query.status,
      date: day ? { gte: day, lt: nextDay } : undefined,
      dailyDuty:
        undefined,
      OR:
        user.role === Role.MOVEMENT_SUPERVISOR
          ? [
              { dailyDuty: { movementSupervisorId: user.id } },
              { sessionFlights: { some: { isCarryOver: true } } },
            ]
          : undefined,
    };
    const [items, total] = await this.prisma.$transaction([
      this.prisma.dailyCompanySession.findMany({
        where,
        include: {
          ...sessionInclude,
          sessionFlights: { include: { flight: true, counterReservations: { include: { counter: true } } } },
        },
        skip,
        take,
        orderBy: { date: 'desc' },
      }),
      this.prisma.dailyCompanySession.count({ where }),
    ]);
    return { items, meta: { total, page, limit } };
  }

  async find(id: string, user: AuthUser) {
    const item = await this.prisma.dailyCompanySession.findUnique({
      where: { id },
      include: {
        ...sessionInclude,
        sessionFlights: {
          include: {
            flight: true,
            createdBy: { select: safeUserSelect },
            counterReservations: { include: { counter: true } },
            flightReports: {
              select: {
                id: true, dailySessionFlightId: true, companyId: true, movementCategoryId: true,
                generatedById: true, format: true, generationType: true, status: true,
                errorMessage: true, mimeType: true, fileSize: true, checksum: true,
                generatedAt: true, templateVersion: true, metadata: true, createdAt: true, updatedAt: true,
              },
            },
          },
        },
        dailyCompanyReports: true,
      },
    });
    if (!item) throw new NotFoundException('Daily company session not found');
    this.access.assertCompanyScope(item.companyId, user);
    if (
      user.role === Role.MOVEMENT_SUPERVISOR &&
      item.dailyDuty.movementSupervisorId !== user.id &&
      !item.sessionFlights.some((flight) => flight.isCarryOver)
    ) {
      throw new ForbiddenException('Daily company session belongs to another supervisor');
    }
    return item;
  }

  async update(id: string, dto: UpdateDailyCompanySessionDto, user: AuthUser) {
    if (dto.plannedFlightsCount !== undefined) this.assertPlannedFlightsCount(dto.plannedFlightsCount);
    await this.access.assertCanModifySession(id, user);
    const updated = await this.prisma.dailyCompanySession.update({ where: { id }, data: dto, include: sessionInclude });
    this.publish(REALTIME_EVENTS.COMPANY_SESSION_UPDATED, updated);
    return updated;
  }

  async changeStatus(id: string, status: DailyCompanySessionStatus, user: AuthUser) {
    await this.access.assertCanModifySession(id, user);
    const current = await this.prisma.dailyCompanySession.findUnique({ where: { id }, include: { sessionFlights: true } });
    if (!current) throw new NotFoundException('Daily company session not found');
    if (current.status === DailyCompanySessionStatus.CLOSED) {
      if (status === DailyCompanySessionStatus.CLOSED) return this.prisma.dailyCompanySession.findUnique({ where: { id }, include: sessionInclude });
      throw new ConflictException('A closed company session cannot be reopened');
    }
    if (status === DailyCompanySessionStatus.CLOSED) {
      const blockers = current.sessionFlights.filter((flight) =>
        flight.status !== DailySessionFlightStatus.CLOSED && flight.status !== DailySessionFlightStatus.CANCELLED);
      if (blockers.length) throw new ConflictException({ message: 'Company session has incomplete flights',
        blockers: blockers.map((flight) => ({ flightId: flight.id, status: flight.status, handoverStatus: flight.handoverStatus })) });
    }
    const changed = await this.prisma.dailyCompanySession.updateMany({ where: { id, status: current.status },
      data: {
        status,
        openedAt: status === DailyCompanySessionStatus.OPEN ? new Date() : undefined,
        closedAt:
          status === DailyCompanySessionStatus.CLOSED || status === DailyCompanySessionStatus.CANCELLED
            ? new Date()
            : undefined,
      },
    });
    if (changed.count !== 1) throw new ConflictException('Company session changed concurrently');
    await this.audit.record({ user, action: status === DailyCompanySessionStatus.CLOSED ? 'CLOSE_DAILY_COMPANY_SESSION' : 'CHANGE_DAILY_COMPANY_SESSION_STATUS',
      entityType: 'DailyCompanySession', entityId: id, metadata: { previousStatus: current.status, nextStatus: status } });
    const updated = await this.prisma.dailyCompanySession.findUniqueOrThrow({ where: { id }, include: sessionInclude });
    this.publish(status === DailyCompanySessionStatus.CLOSED ? REALTIME_EVENTS.COMPANY_SESSION_CLOSED : REALTIME_EVENTS.COMPANY_SESSION_UPDATED, updated);
    return updated;
  }

  private publish(event: typeof REALTIME_EVENTS.COMPANY_SESSION_CREATED | typeof REALTIME_EVENTS.COMPANY_SESSION_UPDATED |
    typeof REALTIME_EVENTS.COMPANY_SESSION_CLOSED, session: { id: string; companyId: string; dailyDutyId: string;
      movementCategoryId: string; status: DailyCompanySessionStatus; updatedAt: Date }) {
    this.realtime?.emitScoped(event, { resourceId: session.id, dailyCompanySessionId: session.id,
      companyId: session.companyId, dailyDutyId: session.dailyDutyId, movementCategoryId: session.movementCategoryId,
      status: session.status, updatedAt: session.updatedAt.toISOString() },
    { companyId: session.companyId, dailyDutyId: session.dailyDutyId, movementCategoryId: session.movementCategoryId, admins: true });
  }

  private assertPlannedFlightsCount(value: number) {
    if (!Number.isInteger(value) || value < 1) {
      throw new BadRequestException('plannedFlightsCount must be a positive integer');
    }
  }

  private assertCanCreateSession(user: AuthUser) {
    if (
      user.role !== Role.MOVEMENT_SUPERVISOR &&
      user.role !== Role.ADMIN &&
      user.role !== Role.SUPER_ADMIN
    ) {
      throw new ForbiddenException('Only movement supervisors and administrators can create company sessions');
    }
  }
}
