import {
  CounterReservationStatus,
  DailyFlightPreCheckStatus,
  DailySessionFlightStatus,
} from '@prisma/client';

export function mapDailyFlightOperationStartResponse(input: {
  flightStatus: DailySessionFlightStatus;
  preCheckStatus: DailyFlightPreCheckStatus;
  reservationStatuses: CounterReservationStatus[];
}) {
  return {
    flightStatus: input.flightStatus,
    preCheckStatus: input.preCheckStatus,
    reservationSummary: {
      total: input.reservationStatuses.length,
      active: input.reservationStatuses.filter(
        (status) => status === CounterReservationStatus.ACTIVE,
      ).length,
    },
  };
}
