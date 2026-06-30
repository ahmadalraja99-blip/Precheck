import { ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { DailyCompanySessionStatus, Prisma, Role } from '@prisma/client';
import { paginate } from '../common/dto/pagination.dto';
import { AuthUser } from '../common/types/auth-user.type';
import { safeUserSelect } from '../common/utils/sanitize-user';
import { OperationAccessService } from '../operations/operation-access.service';
import { PrismaService } from '../prisma/prisma.service';
import { CreateDailyCompanySessionDto } from './dto/create-daily-company-session.dto';
import { DailyCompanySessionQueryDto } from './dto/daily-company-session-query.dto';
import { GetOrCreateDailyCompanySessionDto } from './dto/get-or-create-daily-company-session.dto';
import { UpdateDailyCompanySessionDto } from './dto/update-daily-company-session.dto';

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
  ) {}

  async create(dto: CreateDailyCompanySessionDto, user: AuthUser) {
    const duty = await this.access.assertActiveDuty(dto.dailyDutyId, user);
    const company = await this.prisma.company.findUnique({ where: { id: dto.companyId } });
    if (!company?.isActive) throw new NotFoundException('Active company not found');
    try {
      return await this.prisma.dailyCompanySession.create({
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
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        throw new ConflictException('A daily company session already exists for this company and duty');
      }
      throw error;
    }
  }

  async getOrCreate(dto: GetOrCreateDailyCompanySessionDto, user: AuthUser) {
    const duty = await this.access.assertActiveDuty(dto.dailyDutyId, user);
    const company = await this.prisma.company.findUnique({ where: { id: dto.companyId } });
    if (!company?.isActive) throw new NotFoundException('Active company not found');

    const where = {
      dailyDutyId_companyId: {
        dailyDutyId: duty.id,
        companyId: dto.companyId,
      },
    } satisfies Prisma.DailyCompanySessionWhereUniqueInput;

    const existing = await this.prisma.dailyCompanySession.findUnique({
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
      return { created: true, session };
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        const session = await this.prisma.dailyCompanySession.findUnique({
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
            flightReports: true,
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
    await this.access.assertCanModifySession(id, user);
    return this.prisma.dailyCompanySession.update({ where: { id }, data: dto, include: sessionInclude });
  }

  async changeStatus(id: string, status: DailyCompanySessionStatus, user: AuthUser) {
    await this.access.assertCanModifySession(id, user);
    return this.prisma.dailyCompanySession.update({
      where: { id },
      data: {
        status,
        openedAt: status === DailyCompanySessionStatus.OPEN ? new Date() : undefined,
        closedAt:
          status === DailyCompanySessionStatus.CLOSED || status === DailyCompanySessionStatus.CANCELLED
            ? new Date()
            : undefined,
      },
      include: sessionInclude,
    });
  }
}
