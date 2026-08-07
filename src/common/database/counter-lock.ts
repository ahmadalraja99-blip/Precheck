import { Prisma } from '@prisma/client';

export async function lockCounterRows(tx: Prisma.TransactionClient, counterIds: string[]) {
  const sortedCounterIds = [...new Set(counterIds)].sort();
  if (!sortedCounterIds.length) return [];

  return tx.$queryRaw<Array<{ id: string }>>(
    Prisma.sql`
      SELECT id
      FROM "Counter"
      WHERE id IN (${Prisma.join(sortedCounterIds)})
      ORDER BY id
      FOR UPDATE
    `,
  );
}
