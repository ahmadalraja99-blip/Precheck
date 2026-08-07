import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class OperationalFlightReportDataService {
  constructor(private readonly prisma: PrismaService) {}

  async assemble(sessionFlightId: string) {
    const flight = await this.prisma.dailySessionFlight.findUnique({
      where: { id: sessionFlightId },
      include: {
        company: true,
        flight: true,
        movementCategory: true,
        dailyCompanySession: { include: { dailyDuty: true } },
        counterReservations: {
          include: { counter: true },
          orderBy: { reservedFrom: 'asc' },
        },
        preCheck: {
          include: {
            startedBy: { select: { id: true, fullName: true } },
            submittedBy: { select: { id: true, fullName: true } },
            itemResults: {
              orderBy: [
                { counterCodeSnapshot: 'asc' },
                { checkItemCategorySnapshot: 'asc' },
                { checkItemOrderSnapshot: 'asc' },
              ],
            },
          },
        },
        outCheck: {
          include: {
            startedBy: { select: { id: true, fullName: true } },
            submittedBy: { select: { id: true, fullName: true } },
            submissions: {
              orderBy: { attemptNumber: 'asc' },
              include: {
                submittedBy: { select: { id: true, fullName: true } },
                items: {
                  orderBy: [
                    { counterCodeSnapshot: 'asc' },
                    { checkItemCategorySnapshot: 'asc' },
                    { checkItemOrderSnapshot: 'asc' },
                  ],
                },
                review: {
                  include: { reviewedBy: { select: { id: true, fullName: true } } },
                },
              },
            },
          },
        },
        operationalIssues: {
          include: { reportedBy: { select: { fullName: true } }, resolvedBy: { select: { fullName: true } } },
          orderBy: [{ attemptNumber: 'asc' }, { reportedAt: 'asc' }],
        },
      },
    });
    if (!flight) throw new NotFoundException('Session flight not found');

    const approvedReviewTimes = flight.outCheck?.submissions
      .map((attempt) => attempt.review)
      .filter((review) => review?.decision === 'APPROVED')
      .map((review) => review!.reviewedAt) ?? [];
    const closedAt = approvedReviewTimes.at(-1) ?? null;

    return {
      company: {
        id: flight.company.id,
        name: flight.company.name,
        code: flight.company.code,
        logoPath: flight.company.logoPath,
        logoUrl: flight.company.logoUrl,
      },
      flight: {
        id: flight.id,
        flightNumber: flight.flight.flightNumber,
        origin: flight.flight.origin,
        destination: flight.flight.destination,
        aircraftType: flight.flight.aircraftType,
        scheduledDepartureAt: flight.flight.scheduledDepartureAt,
        checkInStartsAt: flight.checkInStartsAt,
        checkInEndsAt: flight.checkInEndsAt,
        status: flight.status,
        isCarryOver: flight.isCarryOver,
        handoverStatus: flight.handoverStatus,
        notes: flight.notes,
      },
      duty: {
        id: flight.dailyCompanySession.dailyDuty.id,
        companySessionId: flight.dailyCompanySession.id,
        movementCategoryCode: flight.movementCategory.code,
        movementCategoryName: flight.movementCategory.name,
        activatedAt: flight.dailyCompanySession.dailyDuty.activatedAt,
        expiresAt: flight.dailyCompanySession.dailyDuty.expiresAt,
      },
      reservations: flight.counterReservations.map((reservation) => ({
        counterCode: reservation.counter.code,
        counterName: reservation.counter.name,
        reservedFrom: reservation.reservedFrom,
        reservedTo: reservation.reservedTo,
        status: reservation.status,
      })),
      preCheck: flight.preCheck && {
        status: flight.preCheck.status,
        startedAt: flight.preCheck.startedAt,
        submittedAt: flight.preCheck.submittedAt,
        startedBy: flight.preCheck.startedBy.fullName,
        submittedBy: flight.preCheck.submittedBy?.fullName ?? null,
        items: flight.preCheck.itemResults.map((item) => ({
          counterCode: item.counterCodeSnapshot,
          counterName: item.counterNameSnapshot,
          checkItemName: item.checkItemNameSnapshot,
          checkItemDescription: item.checkItemDescriptionSnapshot,
          category: item.checkItemCategorySnapshot,
          required: item.checkItemRequiredSnapshot,
          order: item.checkItemOrderSnapshot,
          result: item.result,
          note: item.note,
          updatedAt: item.updatedAt,
        })),
      },
      outCheck: flight.outCheck && {
        status: flight.outCheck.status,
        startedAt: flight.outCheck.startedAt,
        startedBy: flight.outCheck.startedBy.fullName,
        attempts: flight.outCheck.submissions.map((attempt) => ({
          attemptNumber: attempt.attemptNumber,
          status: attempt.status,
          submittedAt: attempt.submittedAt,
          submittedBy: attempt.submittedBy?.fullName ?? null,
          totals: {
            total: attempt.totalCount,
            pass: attempt.passCount,
            fail: attempt.failCount,
            notApplicable: attempt.notApplicableCount,
          },
          items: attempt.items.map((item) => ({
            counterCode: item.counterCodeSnapshot,
            counterName: item.counterNameSnapshot,
            checkItemName: item.checkItemNameSnapshot,
            checkItemDescription: item.checkItemDescriptionSnapshot,
            category: item.checkItemCategorySnapshot,
            required: item.checkItemRequiredSnapshot,
            order: item.checkItemOrderSnapshot,
            result: item.result,
            note: item.note,
            submittedAt: attempt.submittedAt,
          })),
          review: attempt.review && {
            decision: attempt.review.decision,
            reviewedBy: attempt.review.reviewedBy.fullName,
            reviewedAt: attempt.review.reviewedAt,
            approvalComment: attempt.review.approvalComment,
            rejectionReason: attempt.review.rejectionReason,
          },
        })),
      },
      operationalIssues: flight.operationalIssues.map((issue) => ({ id: issue.id,
        counterCode: issue.counterCodeSnapshot, checkItemName: issue.checkItemNameSnapshot,
        description: issue.checkItemDescriptionSnapshot, attemptNumber: issue.attemptNumber,
        failureNote: issue.failureNote, rejectionReason: issue.rejectionReason, status: issue.status,
        reportedBy: issue.reportedBy.fullName, reportedAt: issue.reportedAt,
        resolutionNote: issue.resolutionNote, verificationNote: issue.verificationNote,
        resolvedBy: issue.resolvedBy?.fullName ?? null, resolvedAt: issue.resolvedAt })),
      lifecycle: {
        finalStatus: flight.status,
        closedAt,
        closedAtBasis: closedAt
          ? 'Approved OutCheck review timestamp (authoritative closure transaction timestamp)'
          : 'No definitive closed timestamp is available',
      },
    };
  }
}

export type OperationalFlightReportData = Awaited<
  ReturnType<OperationalFlightReportDataService['assemble']>
>;
