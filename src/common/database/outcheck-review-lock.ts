import { Prisma } from "@prisma/client";

export async function lockDailyFlightOutCheckReviewRows(
  tx: Prisma.TransactionClient,
  reviewIds: string[],
) {
  const sortedIds = [...new Set(reviewIds)].sort();
  if (!sortedIds.length) return [];

  return tx.$queryRaw<Array<{ id: string }>>(
    Prisma.sql`
      SELECT id
      FROM "DailyFlightOutCheckReview"
      WHERE id IN (${Prisma.join(sortedIds)})
      ORDER BY id
      FOR UPDATE
    `,
  );
}
