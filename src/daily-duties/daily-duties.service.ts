import { ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import {
  DailyDutyStatus,
  OperationalReportGenerationType,
  Prisma,
  Role,
} from '@prisma/client';
import { paginate } from '../common/dto/pagination.dto';
import { AuthUser } from '../common/types/auth-user.type';
import { safeUserSelect } from '../common/utils/sanitize-user';
import { DutyExpirationService } from '../operations/duty-expiration.service';
import { OperationAccessService } from '../operations/operation-access.service';
import { PrismaService } from '../prisma/prisma.service';
import { ActivateDailyDutyDto } from './dto/activate-daily-duty.dto';
import { CloseDailyDutyDto } from './dto/close-daily-duty.dto';
import { DailyDutyQueryDto } from './dto/daily-duty-query.dto';

const dutyInclude = {
  movementCategory: true,
  movementSupervisor: { select: safeUserSelect },
  createdBy: { select: safeUserSelect },
} satisfies Prisma.DailyDutyInclude;

@Injectable()
export class DailyDutiesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly expiration: DutyExpirationService,
    private readonly access: OperationAccessService,
  ) {}

  async activate(dto: ActivateDailyDutyDto, user: AuthUser) {
    await this.expiration.expireDueDuties();
    const category = await this.prisma.movementCategory.findUnique({ where: { id: dto.movementCategoryId } });
    if (!category?.isActive) throw new NotFoundException('Active movement category not found');
    if (user.role === Role.MOVEMENT_SUPERVISOR) {
      const assignment = await this.prisma.movementCategoryAssignment.findFirst({
        where: { userId: user.id, movementCategoryId: dto.movementCategoryId, isActive: true },
      });
      if (!assignment) throw new ForbiddenException('Movement category is not assigned to this supervisor');
    }

    let duty: { id: string } | undefined;
    for (let attempt = 0; attempt < 3 && !duty; attempt += 1) {
      try {
        duty = await this.prisma.$transaction(
          async (tx) => {
            const active = await tx.dailyDuty.findFirst({
              where: { status: DailyDutyStatus.OPEN, expiresAt: { gt: new Date() } },
              orderBy: { activatedAt: 'desc' },
            });
            if (active) {
              if (
                active.movementSupervisorId === user.id &&
                active.movementCategoryId === dto.movementCategoryId
              ) {
                return active;
              }
              throw new ConflictException('Another movement duty is already active');
            }
            const activatedAt = new Date();
            const expiresAt = new Date(activatedAt.getTime() + 24 * 60 * 60 * 1000);
            return tx.dailyDuty.create({
              data: {
                movementCategoryId: dto.movementCategoryId,
                movementSupervisorId: user.id,
                createdById: user.id,
                activatedAt,
                expiresAt,
              },
            });
          },
          { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
        );
      } catch (error) {
        if (
          error instanceof Prisma.PrismaClientKnownRequestError &&
          error.code === 'P2034' &&
          attempt < 2
        ) {
          continue;
        }
        throw error;
      }
    }
    if (!duty) throw new ConflictException('Another movement duty is already active');
    return this.prisma.dailyDuty.findUnique({ where: { id: duty.id }, include: dutyInclude });
  }

  active(user: AuthUser) {
    return this.access.activeDutyForUser(user);
  }

  async carryOver(user: AuthUser) {
    const activeDuty = await this.access.activeDutyForUser(user);
    if (!activeDuty) throw new ForbiddenException('An active daily duty is required');
    return this.prisma.dailySessionFlight.findMany({
      where: { isCarryOver: true, handoverStatus: { in: ['PENDING', 'ACCEPTED'] } },
      include: {
        company: true,
        flight: true,
        movementCategory: true,
        dailyCompanySession: {
          include: {
            dailyDuty: { include: { movementSupervisor: { select: safeUserSelect } } },
          },
        },
        counterReservations: { include: { counter: true } },
      },
      orderBy: { checkInEndsAt: 'asc' },
    });
  }

  async list(query: DailyDutyQueryDto, user: AuthUser) {
    await this.expiration.expireDueDuties();
    const { skip, take, page, limit } = paginate(query);
    const day = query.date ? new Date(query.date) : undefined;
    const nextDay = day ? new Date(day.getTime() + 24 * 60 * 60 * 1000) : undefined;
    const where: Prisma.DailyDutyWhereInput = {
      movementCategoryId: query.movementCategoryId,
      movementSupervisorId:
        user.role === Role.MOVEMENT_SUPERVISOR ? user.id : query.movementSupervisorId,
      status: query.status,
      activatedAt: day ? { gte: day, lt: nextDay } : undefined,
    };
    const [items, total] = await this.prisma.$transaction([
      this.prisma.dailyDuty.findMany({ where, include: dutyInclude, skip, take, orderBy: { activatedAt: 'desc' } }),
      this.prisma.dailyDuty.count({ where }),
    ]);
    return { items, meta: { total, page, limit } };
  }

  async find(id: string, user: AuthUser) {
    const duty = await this.prisma.dailyDuty.findUnique({
      where: { id },
      include: {
        ...dutyInclude,
        dailyCompanySessions: { include: { company: true } },
      },
    });
    if (!duty) throw new NotFoundException('Daily duty not found');
    if (user.role === Role.MOVEMENT_SUPERVISOR && duty.movementSupervisorId !== user.id) {
      throw new ForbiddenException('Daily duty belongs to another supervisor');
    }
    return duty;
  }

  async finish(
    id: string,
    status: DailyDutyStatus,
    dto: CloseDailyDutyDto,
    user: AuthUser,
  ) {
    const duty = await this.prisma.dailyDuty.findUnique({ where: { id } });
    if (!duty) throw new NotFoundException('Daily duty not found');
    if (user.role === Role.MOVEMENT_SUPERVISOR && duty.movementSupervisorId !== user.id) {
      throw new ForbiddenException('Daily duty belongs to another supervisor');
    }
    if (duty.status !== DailyDutyStatus.OPEN) throw new ConflictException('Daily duty is not open');
    const updated = await this.prisma.dailyDuty.update({
      where: { id },
      data: { status, closedAt: new Date(), notes: dto.notes ?? duty.notes },
      include: dutyInclude,
    });
    await this.expiration.markCarryOver(id, updated.closedAt ?? new Date());
    await this.expiration.generateDutySnapshots(
      id,
      OperationalReportGenerationType.AUTOMATIC_FINAL_CLOSE,
    );
    return updated;
  }
}
