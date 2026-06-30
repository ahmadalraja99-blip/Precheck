import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  CounterReservationStatus,
  DailySessionFlightStatus,
  HandoverStatus,
  Prisma,
  Role,
} from '@prisma/client';
import { paginate } from '../common/dto/pagination.dto';
import { AuthUser } from '../common/types/auth-user.type';
import { safeUserSelect } from '../common/utils/sanitize-user';
import { OperationAccessService } from '../operations/operation-access.service';
import { PrismaService } from '../prisma/prisma.service';
import { AddSessionFlightDto } from './dto/add-session-flight.dto';
import { SessionFlightQueryDto } from './dto/session-flight-query.dto';

const itemInclude = {
  company: true,
  flight: true,
  movementCategory: true,
  createdBy: { select: safeUserSelect },
  dailyCompanySession: {
    include: {
      company: true,
      dailyDuty: {
        include: {
          movementCategory: true,
          movementSupervisor: { select: safeUserSelect },
        },
      },
    },
  },
  counterReservations: { include: { counter: true } },
  flightReports: true,
} satisfies Prisma.DailySessionFlightInclude;

@Injectable()
export class SessionFlightsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly access: OperationAccessService,
  ) {}

  async add(sessionId: string, dto: AddSessionFlightDto, user: AuthUser) {
    if ((!dto.flightId && !dto.flight) || (dto.flightId && dto.flight)) {
      throw new BadRequestException('Provide either flightId or flight');
    }
    const session = await this.access.assertCanModifySession(sessionId, user);
    const checkInStartsAt = new Date(dto.checkInStartsAt);
    const checkInEndsAt = new Date(dto.checkInEndsAt);
    if (checkInStartsAt >= checkInEndsAt) {
      throw new BadRequestException('checkInStartsAt must be before checkInEndsAt');
    }
    if (dto.flight && dto.flight.companyId !== session.companyId) {
      throw new BadRequestException('Flight company must match daily company session');
    }
    if (
      dto.flight?.scheduledArrivalAt &&
      new Date(dto.flight.scheduledArrivalAt) <= new Date(dto.flight.scheduledDepartureAt)
    ) {
      throw new BadRequestException('scheduledArrivalAt must be after scheduledDepartureAt');
    }

    const created = await this.prisma.$transaction(async (tx) => {
      const flight = dto.flightId
        ? await tx.flight.findUnique({ where: { id: dto.flightId } })
        : await tx.flight.create({
            data: {
              ...dto.flight!,
              scheduledDepartureAt: new Date(dto.flight!.scheduledDepartureAt),
              scheduledArrivalAt: dto.flight!.scheduledArrivalAt
                ? new Date(dto.flight!.scheduledArrivalAt)
                : undefined,
            },
          });
      if (!flight) throw new NotFoundException('Flight not found');
      if (flight.companyId !== session.companyId) {
        throw new BadRequestException('Flight company must match daily company session');
      }
      const existing = await tx.dailySessionFlight.findFirst({
        where: { dailyCompanySessionId: sessionId, flightId: flight.id },
      });
      if (existing) throw new ConflictException('Flight is already added to this daily company session');
      const carryOver = checkInEndsAt > session.dailyDuty.expiresAt;
      return tx.dailySessionFlight.create({
        data: {
          dailyCompanySessionId: session.id,
          flightId: flight.id,
          companyId: session.companyId,
          movementCategoryId: session.movementCategoryId,
          checkInStartsAt,
          checkInEndsAt,
          notes: dto.notes,
          createdById: user.id,
          isCarryOver: carryOver,
          handoverStatus: carryOver ? HandoverStatus.PENDING : HandoverStatus.NONE,
          carriedFromDailyDutyId: carryOver ? session.dailyDutyId : undefined,
        },
      });
    });
    const sessionFlight = await this.prisma.dailySessionFlight.findUnique({
      where: { id: created.id },
      include: itemInclude,
    });
    return {
      sessionFlight,
      warning:
        sessionFlight?.isCarryOver
          ? 'This flight extends beyond current duty expiration and will be marked as carry-over.'
          : undefined,
    };
  }

  async listForSession(sessionId: string, user: AuthUser) {
    const session = await this.prisma.dailyCompanySession.findUnique({ where: { id: sessionId } });
    if (!session) throw new NotFoundException('Daily company session not found');
    this.access.assertCompanyScope(session.companyId, user);
    return this.prisma.dailySessionFlight.findMany({
      where: { dailyCompanySessionId: sessionId },
      include: itemInclude,
      orderBy: { checkInStartsAt: 'asc' },
    });
  }

  async list(query: SessionFlightQueryDto, user: AuthUser) {
    const { skip, take, page, limit } = paginate(query);
    const day = query.date ? new Date(query.date) : undefined;
    const nextDay = day ? new Date(day.getTime() + 24 * 60 * 60 * 1000) : undefined;
    const where: Prisma.DailySessionFlightWhereInput = {
      companyId: user.role === Role.COMPANY_USER ? user.companyId ?? '__unlinked__' : query.companyId,
      movementCategoryId: query.movementCategoryId,
      checkInStartsAt: day ? { gte: day, lt: nextDay } : undefined,
      flight: query.flightNumber
        ? { flightNumber: { contains: query.flightNumber, mode: 'insensitive' } }
        : undefined,
      status: query.status,
      isCarryOver: query.isCarryOver,
      handoverStatus: query.handoverStatus,
      OR:
        user.role === Role.MOVEMENT_SUPERVISOR
          ? [
              { dailyCompanySession: { dailyDuty: { movementSupervisorId: user.id } } },
              { isCarryOver: true },
            ]
          : undefined,
    };
    const [items, total] = await this.prisma.$transaction([
      this.prisma.dailySessionFlight.findMany({
        where,
        include: itemInclude,
        skip,
        take,
        orderBy: { checkInStartsAt: 'desc' },
      }),
      this.prisma.dailySessionFlight.count({ where }),
    ]);
    return { items, meta: { total, page, limit } };
  }

  async find(id: string, user: AuthUser) {
    const item = await this.prisma.dailySessionFlight.findUnique({ where: { id }, include: itemInclude });
    if (!item) throw new NotFoundException('Session flight not found');
    this.access.assertCompanyScope(item.companyId, user);
    if (
      user.role === Role.MOVEMENT_SUPERVISOR &&
      item.dailyCompanySession.dailyDuty.movementSupervisorId !== user.id &&
      !item.isCarryOver
    ) {
      throw new ForbiddenException('Session flight belongs to another supervisor');
    }
    return item;
  }

  async updateStatus(id: string, status: DailySessionFlightStatus, user: AuthUser) {
    const item = await this.access.assertCanModifySessionFlight(id, user);
    return this.prisma.$transaction(async (tx) => {
      if (status === DailySessionFlightStatus.CLOSED) {
        await tx.counterReservation.updateMany({
          where: {
            dailySessionFlightId: id,
            status: { in: [CounterReservationStatus.SCHEDULED, CounterReservationStatus.ACTIVE] },
          },
          data: { status: CounterReservationStatus.RELEASED },
        });
      }
      if (status === DailySessionFlightStatus.CANCELLED) {
        await tx.counterReservation.updateMany({
          where: {
            dailySessionFlightId: id,
            status: { in: [CounterReservationStatus.SCHEDULED, CounterReservationStatus.ACTIVE] },
          },
          data: { status: CounterReservationStatus.CANCELLED },
        });
      }
      return tx.dailySessionFlight.update({
        where: { id },
        data: {
          status,
          handoverStatus:
            item.isCarryOver && status === DailySessionFlightStatus.CLOSED
              ? HandoverStatus.COMPLETED
              : undefined,
        },
        include: itemInclude,
      });
    });
  }

  async acceptCarryOver(id: string, user: AuthUser) {
    const item = await this.prisma.dailySessionFlight.findUnique({ where: { id } });
    if (!item) throw new NotFoundException('Session flight not found');
    if (!item.isCarryOver) throw new BadRequestException('Session flight is not carry-over');
    const duty = await this.access.activeDutyForUser(user);
    if (!duty) throw new ForbiddenException('An active daily duty is required');
    return this.prisma.dailySessionFlight.update({
      where: { id },
      data: { handoverStatus: HandoverStatus.ACCEPTED, carriedToDailyDutyId: duty.id },
      include: itemInclude,
    });
  }
}
