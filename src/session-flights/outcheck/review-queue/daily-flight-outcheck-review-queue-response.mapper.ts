import {
  DailyDutyStatus,
  DailyFlightOutCheckSubmissionStatus,
} from "@prisma/client";

export interface DailyFlightOutCheckReviewQueueRecord {
  attemptNumber: number;
  status: DailyFlightOutCheckSubmissionStatus;
  submittedAt: Date | null;
  submittedBy: { fullName: string } | null;
  totalCount: number;
  passCount: number;
  failCount: number;
  notApplicableCount: number;
  outCheck: {
    dailySessionFlight: {
      id: string;
      flight: {
        flightNumber: string;
        origin: string | null;
        destination: string | null;
        scheduledDepartureAt: Date;
      };
      company: { code: string; name: string };
      movementCategory: { code: string; name: string };
      dailyCompanySession: {
        dailyDuty: {
          status: DailyDutyStatus;
          activatedAt: Date;
          expiresAt: Date;
          closedAt: Date | null;
        };
      };
    };
  };
}

export function mapDailyFlightOutCheckReviewQueueItem(
  submission: DailyFlightOutCheckReviewQueueRecord,
) {
  const sessionFlight = submission.outCheck.dailySessionFlight;
  const duty = sessionFlight.dailyCompanySession.dailyDuty;
  return {
    sessionFlightId: sessionFlight.id,
    attemptNumber: submission.attemptNumber,
    submissionStatus: submission.status,
    submittedAt: submission.submittedAt,
    submittedBy: submission.submittedBy,
    summary: {
      total: submission.totalCount,
      passed: submission.passCount,
      failed: submission.failCount,
      notApplicable: submission.notApplicableCount,
    },
    flight: {
      flightNumber: sessionFlight.flight.flightNumber,
      origin: sessionFlight.flight.origin,
      destination: sessionFlight.flight.destination,
      scheduledDeparture: sessionFlight.flight.scheduledDepartureAt,
    },
    company: sessionFlight.company,
    movementCategory: sessionFlight.movementCategory,
    dailyDuty: {
      status: duty.status,
      activatedAt: duty.activatedAt,
      expiresAt: duty.expiresAt,
      closedAt: duty.closedAt,
    },
  };
}
