import { DailyFlightCheckResult, DailyFlightOutCheckStatus } from '@prisma/client';

export interface OutCheckResponseRecord {
  status: DailyFlightOutCheckStatus;
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

export function mapDailyFlightOutCheckResponse(outCheck: OutCheckResponseRecord) {
  const summary = {
    total: outCheck.itemResults.length,
    answered: 0,
    unanswered: 0,
    passed: 0,
    failed: 0,
    notApplicable: 0,
  };
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

  for (const item of outCheck.itemResults) {
    if (item.result === null) summary.unanswered += 1;
    else {
      summary.answered += 1;
      if (item.result === DailyFlightCheckResult.PASS) summary.passed += 1;
      if (item.result === DailyFlightCheckResult.FAIL) summary.failed += 1;
      if (item.result === DailyFlightCheckResult.NOT_APPLICABLE) {
        summary.notApplicable += 1;
      }
    }
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
    status: outCheck.status,
    startedAt: outCheck.startedAt,
    submittedAt: outCheck.submittedAt,
    startedBy: outCheck.startedBy,
    submittedBy: outCheck.submittedBy,
    summary,
    counters: [...counters.values()],
  };
}
