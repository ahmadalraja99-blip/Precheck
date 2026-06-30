import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma, Role } from '@prisma/client';
import { paginate } from '../common/dto/pagination.dto';
import { AuthUser } from '../common/types/auth-user.type';
import { OperationAccessService } from '../operations/operation-access.service';
import { PrismaService } from '../prisma/prisma.service';
import { CreateFlightDto } from './dto/create-flight.dto';
import { FlightQueryDto } from './dto/flight-query.dto';
import { UpdateFlightStatusDto } from './dto/update-flight-status.dto';
import { UpdateFlightDto } from './dto/update-flight.dto';

@Injectable()
export class FlightsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly access: OperationAccessService,
  ) {}

  private async assertWriteAccess(user: AuthUser) {
    if (user.role === Role.MOVEMENT_SUPERVISOR && !(await this.access.activeDutyForUser(user))) {
      throw new ForbiddenException('An active daily duty is required');
    }
  }

  async create(dto: CreateFlightDto, user: AuthUser) {
    await this.assertWriteAccess(user);
    const company = await this.prisma.company.findUnique({ where: { id: dto.companyId } });
    if (!company?.isActive) throw new NotFoundException('Active company not found');
    const departure = new Date(dto.scheduledDepartureAt);
    const arrival = dto.scheduledArrivalAt ? new Date(dto.scheduledArrivalAt) : undefined;
    if (arrival && arrival <= departure) {
      throw new BadRequestException('scheduledArrivalAt must be after scheduledDepartureAt');
    }
    return this.prisma.flight.create({
      data: {
        ...dto,
        scheduledDepartureAt: departure,
        scheduledArrivalAt: arrival,
      },
      include: { company: true },
    });
  }

  async list(query: FlightQueryDto, user: AuthUser) {
    const { skip, take, page, limit } = paginate(query);
    const day = query.date ? new Date(query.date) : undefined;
    const nextDay = day ? new Date(day.getTime() + 24 * 60 * 60 * 1000) : undefined;
    const where: Prisma.FlightWhereInput = {
      companyId: user.role === Role.COMPANY_USER ? user.companyId ?? '__unlinked__' : query.companyId,
      scheduledDepartureAt: day ? { gte: day, lt: nextDay } : undefined,
      flightNumber: query.flightNumber ? { contains: query.flightNumber, mode: 'insensitive' } : undefined,
      destination: query.destination ? { contains: query.destination, mode: 'insensitive' } : undefined,
      status: query.status,
    };
    const [items, total] = await this.prisma.$transaction([
      this.prisma.flight.findMany({
        where,
        include: { company: true },
        skip,
        take,
        orderBy: { scheduledDepartureAt: 'desc' },
      }),
      this.prisma.flight.count({ where }),
    ]);
    return { items, meta: { total, page, limit } };
  }

  async find(id: string, user: AuthUser) {
    const flight = await this.prisma.flight.findUnique({
      where: { id },
      include: {
        company: true,
        sessionFlights: {
          include: {
            movementCategory: true,
            dailyCompanySession: { include: { dailyDuty: true } },
            counterReservations: { include: { counter: true } },
            flightReports: true,
          },
        },
      },
    });
    if (!flight) throw new NotFoundException('Flight not found');
    this.access.assertCompanyScope(flight.companyId, user);
    return flight;
  }

  async update(id: string, dto: UpdateFlightDto, user: AuthUser) {
    await this.assertWriteAccess(user);
    const current = await this.find(id, user);
    const departure = dto.scheduledDepartureAt
      ? new Date(dto.scheduledDepartureAt)
      : current.scheduledDepartureAt;
    const arrival = dto.scheduledArrivalAt
      ? new Date(dto.scheduledArrivalAt)
      : current.scheduledArrivalAt;
    if (arrival && arrival <= departure) {
      throw new BadRequestException('scheduledArrivalAt must be after scheduledDepartureAt');
    }
    return this.prisma.flight.update({
      where: { id },
      data: { ...dto, scheduledDepartureAt: departure, scheduledArrivalAt: arrival },
      include: { company: true },
    });
  }

  async updateStatus(id: string, dto: UpdateFlightStatusDto, user: AuthUser) {
    await this.assertWriteAccess(user);
    await this.find(id, user);
    return this.prisma.flight.update({ where: { id }, data: { status: dto.status }, include: { company: true } });
  }
}
