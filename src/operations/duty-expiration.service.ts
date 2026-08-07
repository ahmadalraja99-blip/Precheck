import { Injectable, Optional } from '@nestjs/common';
import {
  DailyCompanySessionStatus,
  DailySessionFlightStatus,
  DailyDutyStatus,
  HandoverStatus,
  OperationalReportFormat,
  OperationalReportGenerationType,
  Prisma,
  Role,
  NotificationType,
} from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { lockDailySessionFlightRows } from '../common/database/daily-session-flight-lock';
import { AuditService } from '../audit/audit.service';
import { NotificationsGateway, REALTIME_EVENTS } from '../notifications/notifications.gateway';

@Injectable()
export class DutyExpirationService {
  constructor(private readonly prisma: PrismaService, private readonly audit: AuditService,
    @Optional() private readonly realtime?: NotificationsGateway) {}

  async expireDueDuties(now = new Date()) {
    const duties = await this.prisma.dailyDuty.findMany({
      where: { status: DailyDutyStatus.OPEN, expiresAt: { lte: now } },
      select: { id: true },
    });
    for (const duty of duties) await this.expireDuty(duty.id);
    return { expired: duties.length };
  }

  async expireDuty(dutyId: string) {
    const expired = await this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT "id" FROM "DailyDuty" WHERE "id"=${dutyId} FOR UPDATE`;
      const duty = await tx.dailyDuty.findUnique({ where: { id: dutyId } });
      if (!duty || duty.status !== DailyDutyStatus.OPEN || duty.expiresAt > new Date()) return null;
      await this.markCarryOverTx(tx, duty.id, duty.expiresAt, 'Daily duty reached its 24-hour expiration');
      await tx.dailyDuty.update({ where: { id: duty.id }, data: { status: DailyDutyStatus.EXPIRED } });
      await this.audit.record({ action: 'EXPIRE_DAILY_DUTY', entityType: 'DailyDuty', entityId: duty.id,
        metadata: { expiresAt: duty.expiresAt.toISOString() } }, tx);
      return duty;
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
    if (!expired) return this.prisma.dailyDuty.findUnique({ where: { id: dutyId } });
    await this.generateDutySnapshots(expired.id, OperationalReportGenerationType.AUTOMATIC_DUTY_EXPIRATION);
    this.realtime?.emitScoped(REALTIME_EVENTS.DUTY_EXPIRED,
      { resourceId: expired.id, dailyDutyId: expired.id, movementCategoryId: expired.movementCategoryId,
        status: DailyDutyStatus.EXPIRED, updatedAt: new Date().toISOString() },
      { dailyDutyId: expired.id, movementCategoryId: expired.movementCategoryId, admins: true });
    return this.prisma.dailyDuty.findUnique({ where: { id: expired.id } });
  }

  async markCarryOver(dutyId: string, boundary: Date) {
    await this.prisma.$transaction(async (tx) => this.markCarryOverTx(tx, dutyId, boundary, 'Daily duty closed with unfinished flight work'));
  }

  private async markCarryOverTx(tx: Prisma.TransactionClient, dutyId: string, boundary: Date, reason: string) {
      const candidates = await tx.dailySessionFlight.findMany({
        where: {
          dailyCompanySession: { dailyDutyId: dutyId },
          status: {
            notIn: [
              DailySessionFlightStatus.CLOSED,
              DailySessionFlightStatus.CANCELLED,
              DailySessionFlightStatus.CARRY_OVER,
            ],
          },
        },
        select: { id: true },
      });
      const candidateIds = candidates.map(({ id }) => id);
      await lockDailySessionFlightRows(tx, candidateIds);
      const currentFlights = await tx.dailySessionFlight.findMany({
        where: {
          id: { in: candidateIds },
          dailyCompanySession: { dailyDutyId: dutyId },
          status: {
            notIn: [
              DailySessionFlightStatus.CLOSED,
              DailySessionFlightStatus.CANCELLED,
              DailySessionFlightStatus.CARRY_OVER,
            ],
          },
        },
        select: { id: true, status: true },
      });
      for (const flight of currentFlights) {
        await tx.dailySessionFlight.update({ where: { id: flight.id }, data: { isCarryOver: true,
          handoverStatus: HandoverStatus.PENDING, carriedFromDailyDutyId: dutyId, carriedAt: boundary,
          carryOverReason: reason, carryOverStatusSnapshot: flight.status } });
        await this.audit.record({ action: 'MARK_DAILY_SESSION_FLIGHT_CARRY_OVER', entityType: 'DailySessionFlight',
          entityId: flight.id, metadata: { sourceDutyId: dutyId, statusAtCarryOver: flight.status, carriedAt: boundary.toISOString() } }, tx);
      }
      await tx.counterReservation.updateMany({
        where: {
          dailySessionFlightId: { in: currentFlights.map(({ id }) => id) },
          status: { in: ['SCHEDULED', 'ACTIVE'] },
        },
        data: { isCarryOver: true },
      });
      await tx.dailyCompanySession.updateMany({
        where: {
          dailyDutyId: dutyId,
          sessionFlights: {
            some: {
              status: {
                notIn: [DailySessionFlightStatus.CLOSED, DailySessionFlightStatus.CANCELLED],
              },
            },
          },
        },
        data: { status: DailyCompanySessionStatus.CARRY_OVER },
      });
      await tx.dailyCompanySession.updateMany({ where: { dailyDutyId: dutyId,
        sessionFlights: { none: { status: { notIn: [DailySessionFlightStatus.CLOSED, DailySessionFlightStatus.CANCELLED] } } },
        status: { in: [DailyCompanySessionStatus.SCHEDULED, DailyCompanySessionStatus.OPEN] } },
        data: { status: DailyCompanySessionStatus.CLOSED, closedAt: boundary } });
      if (currentFlights.length) await tx.notification.create({ data: { title: 'Carry-over handover available',
        message: `${currentFlights.length} flight(s) require handover from an expired duty.`,
        type: NotificationType.SESSION_CREATED, targetRole: Role.MOVEMENT_SUPERVISOR,
        entityType: 'DailyDuty', entityId: dutyId } });
  }

  async generateDutySnapshots(dutyId: string, generationType: OperationalReportGenerationType) {
    const sessions = await this.prisma.dailyCompanySession.findMany({
      where: { dailyDutyId: dutyId },
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
    for (const session of sessions) {
      const existing = await this.prisma.dailyCompanyReport.findFirst({
        where: {
          dailyCompanySessionId: session.id,
          format: OperationalReportFormat.PDF,
          generationType,
        },
      });
      if (existing) continue;
      const closedFlights = session.sessionFlights.filter((item) => item.status === DailySessionFlightStatus.CLOSED).length;
      const carryOverFlights = session.sessionFlights.filter((item) => item.isCarryOver).length;
      const metadata: Prisma.InputJsonObject = {
        company: session.company.name,
        date: session.date.toISOString(),
        movementCategory: session.movementCategory.code,
        movementSupervisor: session.dailyDuty.movementSupervisor.fullName,
        totalFlights: session.sessionFlights.length,
        closedFlights,
        openFlights: session.sessionFlights.length - closedFlights,
        carryOverFlights,
        flightNumbers: session.sessionFlights.map((item) => item.flight.flightNumber),
        countersUsed: [
          ...new Set(
            session.sessionFlights.flatMap((item) =>
              item.counterReservations.map((reservation) => reservation.counter.code),
            ),
          ),
        ],
        sessionStatus: session.status,
        generatedAutomatically: true,
      };
      try { await this.prisma.dailyCompanyReport.create({ data: {
          dailyCompanySessionId: session.id,
          companyId: session.companyId,
          movementCategoryId: session.movementCategoryId,
          generatedById: session.dailyDuty.createdById,
          totalFlights: session.sessionFlights.length,
          format: OperationalReportFormat.PDF,
          generationType,
          metadata,
        } }); } catch (error) {
        if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== 'P2002') throw error;
      }
    }
  }
}
