import { Prisma } from '@prisma/client';

async function lockRows(
  tx: Prisma.TransactionClient,
  table: 'CounterReservation' | 'DailyFlightPreCheck' | 'DailyFlightPreCheckItemResult',
  ids: string[],
) {
  const sortedIds = [...new Set(ids)].sort();
  if (!sortedIds.length) return [];

  const tableName =
    table === 'CounterReservation'
      ? Prisma.raw('"CounterReservation"')
      : table === 'DailyFlightPreCheck'
        ? Prisma.raw('"DailyFlightPreCheck"')
        : Prisma.raw('"DailyFlightPreCheckItemResult"');

  return tx.$queryRaw<Array<{ id: string }>>(
    Prisma.sql`
      SELECT id
      FROM ${tableName}
      WHERE id IN (${Prisma.join(sortedIds)})
      ORDER BY id
      FOR UPDATE
    `,
  );
}

export function lockCounterReservationRows(
  tx: Prisma.TransactionClient,
  ids: string[],
) {
  return lockRows(tx, 'CounterReservation', ids);
}

export function lockDailyFlightPreCheckRows(
  tx: Prisma.TransactionClient,
  ids: string[],
) {
  return lockRows(tx, 'DailyFlightPreCheck', ids);
}

export function lockDailyFlightPreCheckItemRows(
  tx: Prisma.TransactionClient,
  ids: string[],
) {
  return lockRows(tx, 'DailyFlightPreCheckItemResult', ids);
}
