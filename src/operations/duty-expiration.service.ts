import { Injectable } from '@nestjs/common';
import {
  DailyCompanySessionStatus,
  DailySessionFlightStatus,
  DailyDutyStatus,
  HandoverStatus,
  OperationalReportFormat,
  OperationalReportGenerationType,
  Prisma,
} from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class DutyExpirationService {
  constructor(private readonly prisma: PrismaService) {}

  async expireDueDuties(now = new Date()) {
    const duties = await this.prisma.dailyDuty.findMany({
      where: { status: DailyDutyStatus.OPEN, expiresAt: { lte: now } },
      select: { id: true },
    });
    for (const duty of duties) await this.expireDuty(duty.id);
    return { expired: duties.length };
  }

  async expireDuty(dutyId: string) {
    const duty = await this.prisma.dailyDuty.findUnique({
      where: { id: dutyId },
      include: { dailyCompanySessions: { select: { id: true } } },
    });
    if (!duty || duty.status !== DailyDutyStatus.OPEN) return duty;
    if (duty.expiresAt > new Date()) return duty;

    await this.prisma.$transaction(async (tx) => {
      await tx.dailyDuty.update({
        where: { id: duty.id },
        data: { status: DailyDutyStatus.EXPIRED, closedAt: duty.expiresAt },
      });
    });
    await this.markCarryOver(duty.id, duty.expiresAt);
    await this.generateDutySnapshots(duty.id, OperationalReportGenerationType.AUTOMATIC_DUTY_EXPIRATION);
    return this.prisma.dailyDuty.findUnique({ where: { id: duty.id } });
  }

  async markCarryOver(dutyId: string, boundary: Date) {
    await this.prisma.$transaction(async (tx) => {
      await tx.dailySessionFlight.updateMany({
        where: {
          dailyCompanySession: { dailyDutyId: dutyId },
          status: { notIn: [DailySessionFlightStatus.CLOSED, DailySessionFlightStatus.CANCELLED] },
        },
        data: {
          isCarryOver: true,
          status: DailySessionFlightStatus.CARRY_OVER,
          handoverStatus: HandoverStatus.PENDING,
          carriedFromDailyDutyId: dutyId,
        },
      });
      await tx.counterReservation.updateMany({
        where: {
          dailyCompanySession: { dailyDutyId: dutyId },
          status: { in: ['SCHEDULED', 'ACTIVE'] },
          reservedTo: { gt: boundary },
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
    });
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
      await this.prisma.dailyCompanyReport.create({
        data: {
          dailyCompanySessionId: session.id,
          companyId: session.companyId,
          movementCategoryId: session.movementCategoryId,
          generatedById: session.dailyDuty.createdById,
          totalFlights: session.sessionFlights.length,
          format: OperationalReportFormat.PDF,
          generationType,
          metadata,
        },
      });
    }
  }
}
