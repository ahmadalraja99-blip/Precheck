import { ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import {
  DailySessionFlightStatus,
  OperationalReportGenerationType,
  Prisma,
  Role,
} from '@prisma/client';
import { AuthUser } from '../common/types/auth-user.type';
import { safeUserSelect } from '../common/utils/sanitize-user';
import { OperationAccessService } from '../operations/operation-access.service';
import { PrismaService } from '../prisma/prisma.service';
import { GenerateDailyCompanyReportDto } from './dto/generate-daily-company-report.dto';
import { GenerateFlightReportDto } from './dto/generate-flight-report.dto';
import { OperationalReportQueryDto } from './dto/operational-report-query.dto';
import { paginate } from '../common/dto/pagination.dto';

@Injectable()
export class OperationalReportsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly access: OperationAccessService,
  ) {}

  async generateFlight(sessionFlightId: string, dto: GenerateFlightReportDto, user: AuthUser) {
    const item = await this.access.assertCanModifySessionFlight(sessionFlightId, user);
    if (dto.force && user.role !== Role.SUPER_ADMIN) {
      throw new ForbiddenException('Only SUPER_ADMIN can force duplicate report generation');
    }
    const existing = await this.prisma.flightReport.findFirst({
      where: {
        dailySessionFlightId: sessionFlightId,
        format: dto.format,
        generationType: OperationalReportGenerationType.MANUAL,
      },
    });
    if (existing && !dto.force) throw new ConflictException('Flight report already exists');
    const full = await this.prisma.dailySessionFlight.findUnique({
      where: { id: sessionFlightId },
      include: {
        company: true,
        movementCategory: true,
        flight: true,
        counterReservations: { include: { counter: true } },
      },
    });
    if (!full) throw new NotFoundException('Session flight not found');
    const metadata: Prisma.InputJsonObject = {
      company: full.company.name,
      movementCategory: full.movementCategory.code,
      dailyCompanySessionId: full.dailyCompanySessionId,
      flightNumber: full.flight.flightNumber,
      checkInStartsAt: full.checkInStartsAt.toISOString(),
      checkInEndsAt: full.checkInEndsAt.toISOString(),
      countersUsed: full.counterReservations.map((reservation) => reservation.counter.code),
      status: full.status,
      isCarryOver: full.isCarryOver,
      handoverStatus: full.handoverStatus,
    };
    return this.prisma.flightReport.create({
      data: {
        dailySessionFlightId: full.id,
        companyId: full.companyId,
        movementCategoryId: full.movementCategoryId,
        generatedById: user.id,
        format: dto.format,
        metadata,
      },
      include: {
        company: true,
        movementCategory: true,
        generatedBy: { select: safeUserSelect },
      },
    });
  }

  async flightReports(sessionFlightId: string, user: AuthUser) {
    const item = await this.prisma.dailySessionFlight.findUnique({ where: { id: sessionFlightId } });
    if (!item) throw new NotFoundException('Session flight not found');
    this.access.assertCompanyScope(item.companyId, user);
    return this.prisma.flightReport.findMany({
      where: { dailySessionFlightId: sessionFlightId },
      include: { company: true, movementCategory: true, generatedBy: { select: safeUserSelect } },
      orderBy: { createdAt: 'desc' },
    });
  }

  async generateDaily(sessionId: string, dto: GenerateDailyCompanyReportDto, user: AuthUser) {
    await this.access.assertCanModifySession(sessionId, user);
    if (dto.force && user.role !== Role.SUPER_ADMIN) {
      throw new ForbiddenException('Only SUPER_ADMIN can force duplicate report generation');
    }
    const existing = await this.prisma.dailyCompanyReport.findFirst({
      where: {
        dailyCompanySessionId: sessionId,
        format: dto.format,
        generationType: OperationalReportGenerationType.MANUAL,
      },
    });
    if (existing && !dto.force) throw new ConflictException('Daily company report already exists');
    const session = await this.prisma.dailyCompanySession.findUnique({
      where: { id: sessionId },
      include: {
        company: true,
        movementCategory: true,
        dailyDuty: { include: { movementSupervisor: true } },
        sessionFlights: {
          include: {
            flight: true,
            counterReservations: { include: { counter: true } },
          },
        },
      },
    });
    if (!session) throw new NotFoundException('Daily company session not found');
    const closedFlights = session.sessionFlights.filter(
      (item) => item.status === DailySessionFlightStatus.CLOSED,
    ).length;
    const metadata: Prisma.InputJsonObject = {
      company: session.company.name,
      date: session.date.toISOString(),
      movementCategory: session.movementCategory.code,
      movementSupervisor: session.dailyDuty.movementSupervisor.fullName,
      totalFlights: session.sessionFlights.length,
      closedFlights,
      openFlights: session.sessionFlights.length - closedFlights,
      carryOverFlights: session.sessionFlights.filter((item) => item.isCarryOver).length,
      flightNumbers: session.sessionFlights.map((item) => item.flight.flightNumber),
      countersUsed: [
        ...new Set(
          session.sessionFlights.flatMap((item) =>
            item.counterReservations.map((reservation) => reservation.counter.code),
          ),
        ),
      ],
      sessionStatus: session.status,
      generatedAutomatically: false,
    };
    return this.prisma.dailyCompanyReport.create({
      data: {
        dailyCompanySessionId: session.id,
        companyId: session.companyId,
        movementCategoryId: session.movementCategoryId,
        generatedById: user.id,
        totalFlights: session.sessionFlights.length,
        format: dto.format,
        metadata,
      },
      include: {
        company: true,
        movementCategory: true,
        generatedBy: { select: safeUserSelect },
      },
    });
  }

  async dailyReports(sessionId: string, user: AuthUser) {
    const session = await this.prisma.dailyCompanySession.findUnique({ where: { id: sessionId } });
    if (!session) throw new NotFoundException('Daily company session not found');
    this.access.assertCompanyScope(session.companyId, user);
    return this.prisma.dailyCompanyReport.findMany({
      where: { dailyCompanySessionId: sessionId },
      include: { company: true, movementCategory: true, generatedBy: { select: safeUserSelect } },
      orderBy: { createdAt: 'desc' },
    });
  }

  async listFlightReports(query: OperationalReportQueryDto, user: AuthUser) {
    const { skip, take, page, limit } = paginate(query);
    const day = query.date ? new Date(query.date) : undefined;
    const nextDay = day ? new Date(day.getTime() + 24 * 60 * 60 * 1000) : undefined;
    const where: Prisma.FlightReportWhereInput = {
      companyId: user.role === Role.COMPANY_USER ? user.companyId ?? '__unlinked__' : query.companyId,
      movementCategoryId: query.movementCategoryId,
      createdAt: day ? { gte: day, lt: nextDay } : undefined,
      dailySessionFlight:
        user.role === Role.MOVEMENT_SUPERVISOR
          ? {
              OR: [
                { dailyCompanySession: { dailyDuty: { movementSupervisorId: user.id } } },
                { isCarryOver: true },
              ],
            }
          : undefined,
    };
    const [items, total] = await this.prisma.$transaction([
      this.prisma.flightReport.findMany({
        where,
        include: {
          company: true,
          movementCategory: true,
          generatedBy: { select: safeUserSelect },
          dailySessionFlight: { include: { flight: true } },
        },
        skip,
        take,
        orderBy: { createdAt: 'desc' },
      }),
      this.prisma.flightReport.count({ where }),
    ]);
    return { items, meta: { total, page, limit } };
  }

  async listDailyReports(query: OperationalReportQueryDto, user: AuthUser) {
    const { skip, take, page, limit } = paginate(query);
    const day = query.date ? new Date(query.date) : undefined;
    const nextDay = day ? new Date(day.getTime() + 24 * 60 * 60 * 1000) : undefined;
    const where: Prisma.DailyCompanyReportWhereInput = {
      companyId: user.role === Role.COMPANY_USER ? user.companyId ?? '__unlinked__' : query.companyId,
      movementCategoryId: query.movementCategoryId,
      createdAt: day ? { gte: day, lt: nextDay } : undefined,
      dailyCompanySession:
        user.role === Role.MOVEMENT_SUPERVISOR
          ? {
              OR: [
                { dailyDuty: { movementSupervisorId: user.id } },
                { sessionFlights: { some: { isCarryOver: true } } },
              ],
            }
          : undefined,
    };
    const [items, total] = await this.prisma.$transaction([
      this.prisma.dailyCompanyReport.findMany({
        where,
        include: {
          company: true,
          movementCategory: true,
          generatedBy: { select: safeUserSelect },
          dailyCompanySession: true,
        },
        skip,
        take,
        orderBy: { createdAt: 'desc' },
      }),
      this.prisma.dailyCompanyReport.count({ where }),
    ]);
    return { items, meta: { total, page, limit } };
  }
}
