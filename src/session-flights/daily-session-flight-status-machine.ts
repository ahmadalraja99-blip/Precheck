import { BadRequestException } from '@nestjs/common';
import { DailySessionFlightStatus } from '@prisma/client';

const {
  SCHEDULED,
  PRECHECK_PENDING,
  PRECHECK_DONE,
  OPERATION,
  OUTCHECK_PENDING,
  CLOSED,
  CANCELLED,
  CARRY_OVER,
} = DailySessionFlightStatus;

export const DAILY_SESSION_FLIGHT_TRANSITIONS = Object.freeze({
  [SCHEDULED]: Object.freeze([PRECHECK_PENDING, CANCELLED, CARRY_OVER]),
  [PRECHECK_PENDING]: Object.freeze([PRECHECK_DONE, CANCELLED, CARRY_OVER]),
  [PRECHECK_DONE]: Object.freeze([OPERATION, CANCELLED, CARRY_OVER]),
  [OPERATION]: Object.freeze([OUTCHECK_PENDING, CARRY_OVER]),
  [OUTCHECK_PENDING]: Object.freeze([CLOSED, CARRY_OVER]),
  [CLOSED]: Object.freeze([]),
  [CANCELLED]: Object.freeze([]),
  [CARRY_OVER]: Object.freeze([]),
} satisfies Readonly<Record<DailySessionFlightStatus, readonly DailySessionFlightStatus[]>>);

export function canTransitionDailySessionFlightStatus(
  current: DailySessionFlightStatus,
  next: DailySessionFlightStatus,
): boolean {
  return DAILY_SESSION_FLIGHT_TRANSITIONS[current].some((candidate) => candidate === next);
}

export function assertDailySessionFlightTransitionAllowed(
  current: DailySessionFlightStatus,
  next: DailySessionFlightStatus,
): void {
  if (!canTransitionDailySessionFlightStatus(current, next)) {
    throw new BadRequestException(
      `Cannot transition Daily Session Flight from ${current} to ${next}.`,
    );
  }
}

export function assertPublicDailySessionFlightStatusChangeAllowed(
  next: DailySessionFlightStatus,
): void {
  if (next !== CANCELLED) {
    throw new BadRequestException(
      'The public Daily Session Flight status endpoint only supports cancellation.',
    );
  }
}
