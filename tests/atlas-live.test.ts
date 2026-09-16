import { describe, expect, it } from "vitest";

import {
  buildLiveKpis,
  buildLiveManagementInputs,
  buildLiveManagementMetrics,
} from "@/lib/atlas-live";
import type {
  KpiValue,
  ManagementInputs,
  ManagementMetric,
  SeriesPoint,
} from "@/types/dashboard";

function kpi(
  key: string,
  format: KpiValue["format"] = "currency",
  deltaMode?: KpiValue["deltaMode"],
): KpiValue {
  return {
    key,
    label: key,
    value: 999,
    plan: 999,
    delta: 999,
    completion: 999,
    deltaMode,
    format,
  };
}

describe("Atlas Live", () => {
  it("recalculates marketing cards from the current point", () => {
    const current: SeriesPoint = {
      key: "2026-02",
      label: "Feb",
      actualBudget: 100,
      planBudget: 125,
      actualConversion: 0.2,
      planConversion: 0.25,
    };
    const previous: SeriesPoint = {
      key: "2026-01",
      label: "Jan",
      actualBudget: 80,
      actualConversion: 0.1,
    };

    const result = buildLiveKpis(
      "marketing",
      [kpi("budget"), kpi("conversion", "percent")],
      current,
      previous,
    );

    expect(result[0]).toMatchObject({
      value: 100,
      plan: 125,
      delta: 0.25,
      completion: 0.8,
    });
    expect(result[1]).toMatchObject({
      value: 0.2,
      plan: 0.25,
      delta: 1,
      completion: 0.8,
    });
  });

  it("derives revenue, cash flow, and sales cards", () => {
    const revenuePoint: SeriesPoint = {
      key: "revenue",
      label: "Revenue",
      revenue: 1_000,
      contractorCost: 250,
      payroll: 300,
    };
    const revenue = buildLiveKpis(
      "revenue",
      [
        kpi("revenue"),
        kpi("contractors"),
        kpi("payroll"),
        kpi("margin"),
        kpi("share", "percent"),
      ],
      revenuePoint,
      null,
    );
    expect(revenue.map(({ value }) => value)).toEqual([
      1_000,
      250,
      300,
      750,
      0.25,
    ]);

    const cashFlow = buildLiveKpis(
      "cash-flow",
      [
        kpi("income"),
        kpi("expense"),
        kpi("net"),
        kpi("profitability", "percent", "percentage-points"),
      ],
      {
        key: "cash",
        label: "Cash",
        liveIncome: 500,
        liveExpense: 200,
        liveNet: 300,
        liveProfitability: 0.6,
      },
      null,
    );
    expect(cashFlow.map(({ value }) => value)).toEqual([500, 200, 300, 0.6]);

    const sales = buildLiveKpis(
      "sales",
      [
        kpi("leads", "integer"),
        kpi("payments", "integer"),
        kpi("conversion", "percent"),
        kpi("revenue"),
      ],
      {
        key: "sales",
        label: "Sales",
        leads: 20,
        payments: 4,
        revenue: 2_000,
      },
      null,
    );
    expect(sales.map(({ value }) => value)).toEqual([20, 4, 0.2, 2_000]);
  });

  it("recalculates management values, norms, and formula inputs", () => {
    const metrics: ManagementMetric[] = [
      {
        key: "cac",
        label: "CAC",
        value: 1_000,
        norm: 700,
        normDirection: "lower",
        normDelta: -3 / 7,
        normDeltaMode: "relative",
        format: "currency",
        hint: "hint",
        source: "source",
        scaleMax: 1_200,
      },
    ];
    const inputs: ManagementInputs = {
      revenue: 10,
      marketingBudget: 10,
      payments: 10,
      grossProfit: 10,
      marketingLeads: 10,
      receiptsWithVat: 10,
      receiptsWithoutVat: 10,
    };
    const point: SeriesPoint = {
      key: "management",
      label: "Management",
      cac: 600,
      managementRevenue: 2_000,
      managementMarketingBudget: 1_200,
      managementPayments: 2,
      managementGrossProfit: 1_500,
      managementMarketingLeads: 12,
      managementReceiptsWithVat: 1_220,
      managementReceiptsWithoutVat: 1_000,
    };

    expect(buildLiveManagementMetrics(metrics, point)[0]).toMatchObject({
      value: 600,
      normDelta: 1 / 7,
    });
    expect(
      buildLiveManagementMetrics(metrics, point)[0]?.scaleMax,
    ).toBeCloseTo(980);
    expect(buildLiveManagementInputs(inputs, point)).toEqual({
      revenue: 2_000,
      marketingBudget: 1_200,
      payments: 2,
      grossProfit: 1_500,
      marketingLeads: 12,
      receiptsWithVat: 1_220,
      receiptsWithoutVat: 1_000,
    });
  });
});
