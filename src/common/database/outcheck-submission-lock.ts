import { Prisma } from "@prisma/client";

export async function lockDailyFlightOutCheckSubmissionRows(
  tx: Prisma.TransactionClient,
  submissionIds: string[],
) {
  const sortedIds = [...new Set(submissionIds)].sort();
  if (!sortedIds.length) return [];

  return tx.$queryRaw<Array<{ id: string }>>(
    Prisma.sql`
      SELECT id
      FROM "DailyFlightOutCheckSubmission"
      WHERE id IN (${Prisma.join(sortedIds)})
      ORDER BY id
      FOR UPDATE
    `,
  );
}

export async function lockDailyFlightOutCheckSubmissionItemRows(
  tx: Prisma.TransactionClient,
  itemIds: string[],
) {
  const sortedIds = [...new Set(itemIds)].sort();
  if (!sortedIds.length) return [];

  return tx.$queryRaw<Array<{ id: string }>>(
    Prisma.sql`
      SELECT id
      FROM "DailyFlightOutCheckSubmissionItem"
      WHERE id IN (${Prisma.join(sortedIds)})
      ORDER BY id
      FOR UPDATE
    `,
  );
}
