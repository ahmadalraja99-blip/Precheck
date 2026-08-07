import { Prisma } from '@prisma/client';

async function lockRows(
  tx: Prisma.TransactionClient,
  table: 'DailyFlightOutCheck' | 'DailyFlightOutCheckItemResult',
  ids: string[],
) {
  const sortedIds = [...new Set(ids)].sort();
  if (!sortedIds.length) return [];
  const tableName =
    table === 'DailyFlightOutCheck'
      ? Prisma.raw('"DailyFlightOutCheck"')
      : Prisma.raw('"DailyFlightOutCheckItemResult"');

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

export function lockDailyFlightOutCheckRows(
  tx: Prisma.TransactionClient,
  ids: string[],
) {
  return lockRows(tx, 'DailyFlightOutCheck', ids);
}

export function lockDailyFlightOutCheckItemRows(
  tx: Prisma.TransactionClient,
  ids: string[],
) {
  return lockRows(tx, 'DailyFlightOutCheckItemResult', ids);
}
