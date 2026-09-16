import type { DashboardSection } from "@/lib/constants";
import type {
  KpiValue,
  ManagementInputs,
  ManagementMetric,
  SeriesPoint,
} from "@/types/dashboard";

function pointNumber(point: SeriesPoint | null, key: string) {
  const value = point?.[key];
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function ratio(numerator: number | null, denominator: number | null) {
  return numerator !== null && denominator !== null && denominator > 0
    ? numerator / denominator
    : null;
}

function revenueValue(point: SeriesPoint | null, key: string) {
  const revenue = pointNumber(point, "revenue");
  const contractors = pointNumber(point, "contractorCost");

  switch (key) {
    case "revenue":
      return revenue;
    case "contractors":
      return contractors;
    case "payroll":
      return pointNumber(point, "payroll");
    case "margin":
      return revenue !== null && contractors !== null
        ? revenue - contractors
        : null;
    case "share":
      return ratio(contractors, revenue);
    default:
      return null;
  }
}

function cashFlowValue(point: SeriesPoint | null, key: string) {
  const fieldByKey: Record<string, string> = {
    income: "liveIncome",
    expense: "liveExpense",
    net: "liveNet",
    profitability: "liveProfitability",
  };
  return pointNumber(point, fieldByKey[key] ?? "");
}

function salesValue(point: SeriesPoint | null, key: string) {
  if (key === "conversion") {
    return ratio(
      pointNumber(point, "payments"),
      pointNumber(point, "leads"),
    );
  }
  return pointNumber(point, key);
}

function marketingValues(point: SeriesPoint | null, key: string) {
  const fields: Record<string, [string, string]> = {
    budget: ["actualBudget", "planBudget"],
    visits: ["actualVisits", "planVisits"],
    leads: ["actualLeads", "planLeads"],
    conversion: ["actualConversion", "planConversion"],
    cpc: ["actualCpc", "planCpc"],
    cpl: ["actualCpl", "planCpl"],
  };
  const fieldsForMetric = fields[key];
  return {
    value: fieldsForMetric
      ? pointNumber(point, fieldsForMetric[0])
      : null,
    plan: fieldsForMetric
      ? pointNumber(point, fieldsForMetric[1])
      : null,
  };
}

function liveValues(
  section: DashboardSection,
  point: SeriesPoint | null,
  key: string,
) {
  switch (section) {
    case "marketing":
      return marketingValues(point, key);
    case "revenue":
      return { value: revenueValue(point, key), plan: null };
    case "cash-flow":
      return { value: cashFlowValue(point, key), plan: null };
    case "sales":
      return { value: salesValue(point, key), plan: null };
    default:
      return { value: null, plan: null };
  }
}

export function buildLiveKpis(
  section: DashboardSection,
  kpis: KpiValue[],
  point: SeriesPoint,
  previousPoint: SeriesPoint | null,
) {
  return kpis.map((kpi) => {
    const current = liveValues(section, point, kpi.key);
    const previous = liveValues(section, previousPoint, kpi.key);
    const delta =
      current.value === null || previous.value === null
        ? null
        : kpi.deltaMode === "percentage-points"
          ? current.value - previous.value
          : previous.value > 0
            ? (current.value - previous.value) / previous.value
            : null;

    return {
      ...kpi,
      value: current.value,
      plan: current.plan,
      delta,
      completion:
        current.value !== null &&
        current.plan !== null &&
        current.plan > 0
          ? current.value / current.plan
          : null,
    };
  });
}

export function buildLiveManagementMetrics(
  metrics: ManagementMetric[],
  point: SeriesPoint,
) {
  return metrics.map((metric) => {
    const pointValue = pointNumber(point, metric.key);
    const value = metric.key in point ? pointValue : metric.value;
    const normDelta =
      value === null
        ? null
        : metric.normDeltaMode === "percentage-points"
          ? value - metric.norm
          : metric.normDirection === "lower"
            ? (metric.norm - value) / metric.norm
            : (value - metric.norm) / metric.norm;

    return {
      ...metric,
      value,
      normDelta,
      scaleMax: Math.max(
        metric.norm * 1.4,
        value === null ? 0 : value * 1.2,
        1,
      ),
    };
  });
}

export function buildLiveManagementInputs(
  inputs: ManagementInputs,
  point: SeriesPoint,
): ManagementInputs {
  const liveValue = (key: string, fallback: number) =>
    key in point ? (pointNumber(point, key) ?? 0) : fallback;

  return {
    revenue: liveValue("managementRevenue", inputs.revenue),
    marketingBudget: liveValue(
      "managementMarketingBudget",
      inputs.marketingBudget,
    ),
    payments: liveValue("managementPayments", inputs.payments),
    grossProfit: liveValue("managementGrossProfit", inputs.grossProfit),
    marketingLeads: liveValue(
      "managementMarketingLeads",
      inputs.marketingLeads,
    ),
    receiptsWithVat: liveValue(
      "managementReceiptsWithVat",
      inputs.receiptsWithVat,
    ),
    receiptsWithoutVat: liveValue(
      "managementReceiptsWithoutVat",
      inputs.receiptsWithoutVat,
    ),
  };
}
