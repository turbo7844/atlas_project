import { describe, expect, it } from "vitest";

import { calculateMarketingMetrics } from "@/services/marketing-metrics";

describe("calculateMarketingMetrics", () => {
  it("считает производные метрики от суммарных значений", () => {
    const result = calculateMarketingMetrics([
      { budget: 1_000, visits: 100, leads: 10 },
      { budget: 3_000, visits: 50, leads: 5 },
    ]);

    expect(result).toEqual({
      budget: 4_000,
      visits: 150,
      leads: 15,
      conversion: 0.1,
      cpc: 4_000 / 150,
      cpl: 4_000 / 15,
    });
  });

  it("возвращает null при нулевом знаменателе", () => {
    expect(
      calculateMarketingMetrics([{ budget: 0, visits: 0, leads: 0 }]),
    ).toMatchObject({
      conversion: null,
      cpc: null,
      cpl: null,
    });
  });
});
