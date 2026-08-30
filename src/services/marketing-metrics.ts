export interface MarketingMetricInput {
  budget: number;
  visits: number;
  leads: number;
}

export interface MarketingMetrics {
  budget: number;
  visits: number;
  leads: number;
  conversion: number | null;
  cpc: number | null;
  cpl: number | null;
}

export function safeRatio(numerator: number, denominator: number) {
  return denominator === 0 ? null : numerator / denominator;
}

export function calculateMarketingMetrics(
  rows: MarketingMetricInput[],
): MarketingMetrics {
  const totals = rows.reduce(
    (result, row) => ({
      budget: result.budget + row.budget,
      visits: result.visits + row.visits,
      leads: result.leads + row.leads,
    }),
    { budget: 0, visits: 0, leads: 0 },
  );

  return {
    ...totals,
    conversion: safeRatio(totals.leads, totals.visits),
    cpc: safeRatio(totals.budget, totals.visits),
    cpl: safeRatio(totals.budget, totals.leads),
  };
}
