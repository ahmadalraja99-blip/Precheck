import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { DailyDutyStatus, Role } from '@prisma/client';
import { AuthUser } from '../common/types/auth-user.type';
import { PrismaService } from '../prisma/prisma.service';
import { DutyExpirationService } from './duty-expiration.service';
import { safeUserSelect } from '../common/utils/sanitize-user';

@Injectable()
export class OperationAccessService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly expiration: DutyExpirationService,
  ) {}

  async activeDutyForUser(user: AuthUser) {
    await this.expiration.expireDueDuties();
    const where =
      user.role === Role.MOVEMENT_SUPERVISOR
        ? { movementSupervisorId: user.id }
        : {};
    return this.prisma.dailyDuty.findFirst({
      where: { ...where, status: DailyDutyStatus.OPEN, expiresAt: { gt: new Date() } },
      include: { movementCategory: true, movementSupervisor: { select: safeUserSelect } },
      orderBy: { activatedAt: 'desc' },
    });
  }

  async assertActiveDuty(dutyId: string, user: AuthUser) {
    const duty = await this.prisma.dailyDuty.findUnique({ where: { id: dutyId } });
    if (!duty) throw new NotFoundException('Daily duty not found');
    if (duty.status === DailyDutyStatus.OPEN && duty.expiresAt <= new Date()) {
      await this.expiration.expireDuty(duty.id);
      throw new ForbiddenException('Daily duty has expired');
    }
    if (duty.status !== DailyDutyStatus.OPEN || duty.expiresAt <= new Date()) {
      throw new ForbiddenException('An active daily duty is required');
    }
    if (user.role === Role.MOVEMENT_SUPERVISOR && duty.movementSupervisorId !== user.id) {
      throw new ForbiddenException('Daily duty belongs to another supervisor');
    }
    return duty;
  }

  async assertCanModifySession(sessionId: string, user: AuthUser) {
    const session = await this.prisma.dailyCompanySession.findUnique({
      where: { id: sessionId },
      include: { dailyDuty: true },
    });
    if (!session) throw new NotFoundException('Daily company session not found');
    await this.assertActiveDuty(session.dailyDutyId, user);
    return session;
  }

  async assertCanModifySessionFlight(sessionFlightId: string, user: AuthUser) {
    const item = await this.prisma.dailySessionFlight.findUnique({
      where: { id: sessionFlightId },
      include: { dailyCompanySession: { include: { dailyDuty: true } } },
    });
    if (!item) throw new NotFoundException('Session flight not found');
    if (item.isCarryOver && user.role === Role.MOVEMENT_SUPERVISOR) {
      const currentDuty = await this.activeDutyForUser(user);
      if (!currentDuty) throw new ForbiddenException('An active daily duty is required');
      return item;
    }
    await this.assertActiveDuty(item.dailyCompanySession.dailyDutyId, user);
    return item;
  }

  assertCompanyScope(companyId: string, user: AuthUser) {
    if (user.role === Role.COMPANY_USER && (!user.companyId || user.companyId !== companyId)) {
      throw new ForbiddenException('Resource belongs to another company');
    }
  }
}
