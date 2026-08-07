import { DailyFlightPreCheckStatus, DailyFlightCheckResult } from '@prisma/client';

export interface PreCheckResponseRecord {
  status: DailyFlightPreCheckStatus;
  startedAt: Date;
  submittedAt: Date | null;
  startedBy: { id: string; fullName: string };
  submittedBy: { id: string; fullName: string } | null;
  itemResults: Array<{
    id: string;
    counterCodeSnapshot: string;
    counterNameSnapshot: string;
    checkItemNameSnapshot: string;
    checkItemDescriptionSnapshot: string | null;
    checkItemCategorySnapshot: string;
    checkItemRequiredSnapshot: boolean;
    checkItemAllowsNotApplicableSnapshot: boolean;
    checkItemOrderSnapshot: number;
    result: DailyFlightCheckResult | null;
    note: string | null;
  }>;
}

export function mapDailyFlightPreCheckResponse(preCheck: PreCheckResponseRecord) {
  const counters = new Map<
    string,
    {
      counter: { code: string; name: string };
      items: Array<{
        itemResultId: string;
        checkItem: {
          name: string;
          description: string | null;
          category: string;
          isRequired: boolean;
          allowsNotApplicable: boolean;
        };
        result: DailyFlightCheckResult | null;
        note: string | null;
      }>;
    }
  >();

  for (const item of preCheck.itemResults) {
    let counter = counters.get(item.counterCodeSnapshot);
    if (!counter) {
      counter = {
        counter: {
          code: item.counterCodeSnapshot,
          name: item.counterNameSnapshot,
        },
        items: [],
      };
      counters.set(item.counterCodeSnapshot, counter);
    }
    counter.items.push({
      itemResultId: item.id,
      checkItem: {
        name: item.checkItemNameSnapshot,
        description: item.checkItemDescriptionSnapshot,
        category: item.checkItemCategorySnapshot,
        isRequired: item.checkItemRequiredSnapshot,
        allowsNotApplicable: item.checkItemAllowsNotApplicableSnapshot,
      },
      result: item.result,
      note: item.note,
    });
  }

  return {
    status: preCheck.status,
    startedAt: preCheck.startedAt,
    submittedAt: preCheck.submittedAt,
    startedBy: preCheck.startedBy,
    submittedBy: preCheck.submittedBy,
    counters: [...counters.values()],
  };
}
