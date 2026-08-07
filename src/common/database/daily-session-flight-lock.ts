import { Prisma } from '@prisma/client';

export async function lockDailySessionFlightRows(
  tx: Prisma.TransactionClient,
  sessionFlightIds: string[],
) {
  const sortedIds = [...new Set(sessionFlightIds)].sort();
  if (!sortedIds.length) return [];

  return tx.$queryRaw<Array<{ id: string }>>(
    Prisma.sql`
      SELECT id
      FROM "DailySessionFlight"
      WHERE id IN (${Prisma.join(sortedIds)})
      ORDER BY id
      FOR UPDATE
    `,
  );
}
