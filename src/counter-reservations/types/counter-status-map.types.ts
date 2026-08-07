import type { CounterStatus } from '@prisma/client';

export const COUNTER_OCCUPANCY_STATUSES = ['AVAILABLE', 'OCCUPIED'] as const;

export type CounterOccupancyStatus = (typeof COUNTER_OCCUPANCY_STATUSES)[number];

export interface CounterStatusMapItem {
  counterId: string;
  code: string;
  name: string;
  storedStatus: CounterStatus;
  occupancyStatus: CounterOccupancyStatus;
}
