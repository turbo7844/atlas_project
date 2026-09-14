import type {
  ContractorCost,
  FintabloTransaction,
  MarketingActual,
  MarketingPlanValue,
  PayrollMonthly,
  SalesMonthly,
} from "@prisma/client";

import {
  CASH_FLOW_DIRECTIONS,
  CASH_FLOW_GENERAL_DIRECTION,
  DIRECTION_BY_SOURCE_NAME,
  DIRECTIONS,
  MONTHS,
  type CashFlowDirectionId,
  type DashboardSection,
  type Granularity,
} from "@/lib/constants";
import { env } from "@/lib/env";
import { prisma } from "@/lib/prisma";
import { calculateMarketingMetrics } from "@/services/marketing-metrics";
import { getDashboardNorms } from "@/services/dashboard-norms";
import type {
  CashFlowRow,
  DashboardQuery,
  DashboardResponse,
  KpiValue,
  MarketingRow,
  ManagementMetric,
  RevenueRow,
  SalesRow,
  SeriesPoint,
} from "@/types/dashboard";

type NumericMarketingRow = {
  directionId: string;
  month: number;
  visits: number;
  leads: number;
  budget: number;
};

type PeriodBucket = {
  key: string;
  label: string;
  months: number[];
};

const monthShort = [
  "Янв",
  "Фев",
  "Мар",
  "Апр",
  "Май",
  "Июн",
  "Июл",
  "Авг",
  "Сен",
  "Окт",
  "Ноя",
  "Дек",
];

const sum = (values: number[]) =>
  values.reduce((total, value) => total + value, 0);

const ratio = (numerator: number, denominator: number) =>
  denominator > 0 ? numerator / denominator : null;

const delta = (current: number, previous: number) =>
  previous > 0 ? (current - previous) / previous : null;

function monthFromKey(key: string) {
  return Number.parseInt(key.split("-")[1] ?? "", 10);
}

function selectedMonths(query: DashboardQuery) {
  const start = Math.max(1, Math.min(12, monthFromKey(query.from)));
  const end = Math.max(start, Math.min(12, monthFromKey(query.to)));
  return Array.from({ length: end - start + 1 }, (_, index) => start + index);
}

function previousMonths(months: number[]) {
  const first = months[0] ?? 1;
  const length = months.length;
  if (first - length < 1) return [];
  return Array.from({ length }, (_, index) => first - length + index);
}

function periodBuckets(months: number[], granularity: Granularity): PeriodBucket[] {
  const buckets = new Map<string, PeriodBucket>();

  for (const month of months) {
    const key =
      granularity === "month"
        ? `2026-${String(month).padStart(2, "0")}`
        : granularity === "quarter"
          ? `2026-Q${Math.ceil(month / 3)}`
          : "2026";
    const label =
      granularity === "month"
        ? monthShort[month - 1]
        : granularity === "quarter"
          ? `${Math.ceil(month / 3)} кв.`
          : "2026";
    const bucket = buckets.get(key) ?? { key, label, months: [] };
    bucket.months.push(month);
    buckets.set(key, bucket);
  }

  return [...buckets.values()];
}

function marketingTotals(rows: NumericMarketingRow[]) {
  return calculateMarketingMetrics(rows);
}

function metricKpi(
  key: string,
  label: string,
  actual: number | null,
  plan: number | null,
  previous: number | null,
  format: KpiValue["format"],
  hint?: string,
): KpiValue {
  return {
    key,
    label,
    value: actual,
    plan,
    delta:
      actual !== null && previous !== null
        ? delta(actual, previous)
        : null,
    completion:
      actual !== null && plan !== null && plan > 0 ? actual / plan : null,
    format,
    hint,
  };
}

function commonMeta(
  section: DashboardSection,
  query: DashboardQuery,
  options: {
    actualThrough?: string | null;
    lastSyncAt?: Date | null;
  } = {},
) {
  return {
    section,
    from: query.from,
    to: query.to,
    granularity: query.granularity,
    directions: query.directions,
    actualThrough:
      "actualThrough" in options ? (options.actualThrough ?? null) : "2026-08",
    planThrough: "2026-12",
    lastSyncAt: options.lastSyncAt?.toISOString() ?? null,
  };
}

function numericPlan(row: MarketingPlanValue): NumericMarketingRow {
  return {
    directionId: row.directionId,
    month: row.month,
    visits: row.visits,
    leads: row.leads,
    budget: row.budget.toNumber(),
  };
}

function numericActual(row: MarketingActual): NumericMarketingRow {
  return {
    directionId: row.directionId,
    month: row.date.getUTCMonth() + 1,
    visits: row.visits,
    leads: row.leads,
    budget: row.budget.toNumber(),
  };
}

async function marketingDashboard(
  query: DashboardQuery,
): Promise<DashboardResponse> {
  const months = selectedMonths(query);
  const syncState =
    env.marketingActualSpreadsheetId && env.marketingActualSheetName
      ? await prisma.marketingActualSyncState.findUnique({
          where: {
            spreadsheetId_sheetName: {
              spreadsheetId: env.marketingActualSpreadsheetId,
              sheetName: env.marketingActualSheetName,
            },
          },
        })
      : await prisma.marketingActualSyncState.findFirst({
          orderBy: { updatedAt: "desc" },
        });
  const actualThrough = syncState?.maxDate?.toISOString().slice(0, 10) ?? null;
  const actualThroughMonth = syncState?.maxDate
    ? syncState.maxDate.getUTCMonth() + 1
    : 0;
  const comparableMonths = months.filter(
    (month) => month <= actualThroughMonth,
  );
  const priorMonths = previousMonths(comparableMonths);
  const snapshot = await prisma.marketingPlanSnapshot.findFirst({
    where: { year: 2026 },
    orderBy: { createdAt: "desc" },
    select: { id: true, createdAt: true },
  });

  const [planDb, actualDb, previousDb] = await Promise.all([
    snapshot
      ? prisma.marketingPlanValue.findMany({
          where: {
            snapshotId: snapshot.id,
            directionId: { in: query.directions },
            month: { in: months },
          },
        })
      : Promise.resolve([]),
    comparableMonths.length
      ? prisma.marketingActual.findMany({
          where: {
            directionId: { in: query.directions },
            date: {
              gte: new Date(
                Date.UTC(2026, comparableMonths[0] - 1, 1),
              ),
              lt: new Date(
                Date.UTC(
                  2026,
                  comparableMonths[comparableMonths.length - 1],
                  1,
                ),
              ),
            },
          },
        })
      : Promise.resolve([]),
    priorMonths.length
      ? prisma.marketingActual.findMany({
          where: {
            directionId: { in: query.directions },
            date: {
              gte: new Date(Date.UTC(2026, priorMonths[0] - 1, 1)),
              lt: new Date(
                Date.UTC(2026, priorMonths[priorMonths.length - 1], 1),
              ),
            },
          },
        })
      : Promise.resolve([]),
  ]);

  const plan = planDb.map(numericPlan);
  const actual = actualDb.map(numericActual);
  const previous = previousDb.map(numericActual);
  const comparablePlan = plan.filter(
    (row) => row.month <= actualThroughMonth,
  );
  const planKpiRows = comparableMonths.length ? comparablePlan : plan;
  const planTotals = marketingTotals(planKpiRows);
  const actualTotals = marketingTotals(actual);
  const previousTotals = marketingTotals(previous);
  const hasActual = actual.length > 0;
  const hasPlan = planKpiRows.length > 0;
  const hasPrevious = previous.length > 0;

  const kpis = [
    metricKpi(
      "budget",
      "Бюджет",
      hasActual ? actualTotals.budget : null,
      hasPlan ? planTotals.budget : null,
      hasPrevious ? previousTotals.budget : null,
      "currency",
    ),
    metricKpi(
      "visits",
      "Посещения",
      hasActual ? actualTotals.visits : null,
      hasPlan ? planTotals.visits : null,
      hasPrevious ? previousTotals.visits : null,
      "integer",
    ),
    metricKpi(
      "leads",
      "Лиды",
      hasActual ? actualTotals.leads : null,
      hasPlan ? planTotals.leads : null,
      hasPrevious ? previousTotals.leads : null,
      "integer",
    ),
    metricKpi(
      "conversion",
      "Конверсия",
      hasActual ? actualTotals.conversion : null,
      hasPlan ? planTotals.conversion : null,
      hasPrevious ? previousTotals.conversion : null,
      "percent",
    ),
    metricKpi(
      "cpc",
      "CPC",
      hasActual ? actualTotals.cpc : null,
      hasPlan ? planTotals.cpc : null,
      hasPrevious ? previousTotals.cpc : null,
      "currency",
      "Стоимость одного посещения",
    ),
    metricKpi(
      "cpl",
      "CPL",
      hasActual ? actualTotals.cpl : null,
      hasPlan ? planTotals.cpl : null,
      hasPrevious ? previousTotals.cpl : null,
      "currency",
      "Стоимость одного лида",
    ),
  ];

  const buckets = periodBuckets(months, query.granularity);
  const series: SeriesPoint[] = buckets.map((bucket) => {
    const planned = plan.filter((row) => bucket.months.includes(row.month));
    const factual = actual.filter((row) => bucket.months.includes(row.month));
    return {
      key: bucket.key,
      label: bucket.label,
      planBudget: planned.length ? marketingTotals(planned).budget : null,
      actualBudget: factual.length ? marketingTotals(factual).budget : null,
    };
  });

  const rows: MarketingRow[] = DIRECTIONS.filter((direction) =>
    query.directions.includes(direction.id),
  ).map((direction) => {
    const directionPlan = planKpiRows.filter(
      (row) => row.directionId === direction.id,
    );
    const directionActual = actual.filter(
      (row) => row.directionId === direction.id,
    );
    const planValue = marketingTotals(directionPlan);
    const actualValue = marketingTotals(directionActual);
    return {
      directionId: direction.id,
      direction: direction.name,
      planBudget: directionPlan.length ? planValue.budget : null,
      actualBudget: directionActual.length ? actualValue.budget : null,
      planVisits: directionPlan.length ? planValue.visits : null,
      actualVisits: directionActual.length ? actualValue.visits : null,
      planLeads: directionPlan.length ? planValue.leads : null,
      actualLeads: directionActual.length ? actualValue.leads : null,
      planConversion: directionPlan.length ? planValue.conversion : null,
      actualConversion: directionActual.length ? actualValue.conversion : null,
      planCpc: directionPlan.length ? planValue.cpc : null,
      actualCpc: directionActual.length ? actualValue.cpc : null,
      planCpl: directionPlan.length ? planValue.cpl : null,
      actualCpl: directionActual.length ? actualValue.cpl : null,
    };
  });

  return {
    meta: {
      ...commonMeta("marketing", query, {
        actualThrough,
        lastSyncAt: syncState?.lastSuccessAt ?? null,
      }),
      notice:
        actualThrough && months.some((month) => month > actualThroughMonth) && comparableMonths.length
          ? `План показан до декабря, сравнение рассчитано по доступному факту на ${actualThrough.split("-").reverse().join(".")}.`
          : actualThrough && months.every((month) => month > actualThroughMonth)
            ? "Для выбранного периода доступен только план."
            : !actualThrough
              ? "Маркетинговый факт ещё не синхронизирован."
            : snapshot
              ? undefined
              : "Маркетинговый план ещё не синхронизирован.",
    },
    kpis,
    series,
    rows,
  };
}

function salesRevenue(rows: SalesMonthly[]) {
  return sum(rows.map((row) => row.revenue.toNumber()));
}

function contractorTotal(rows: ContractorCost[]) {
  return sum(rows.map((row) => row.amount.toNumber()));
}

function payrollTotals(rows: PayrollMonthly[]) {
  const salary = sum(rows.map((row) => row.salary.toNumber()));
  const vacationPay = sum(rows.map((row) => row.vacationPay.toNumber()));
  const bonus = sum(rows.map((row) => row.bonus.toNumber()));
  const salesBonus = sum(rows.map((row) => row.salesBonus.toNumber()));
  return {
    total: salary + vacationPay + bonus + salesBonus,
    salary,
    vacationPay,
    bonus,
    salesBonus,
  };
}

async function revenueDashboard(
  query: DashboardQuery,
): Promise<DashboardResponse> {
  const months = selectedMonths(query);
  const priorMonths = previousMonths(months);
  const baseWhere = {
    year: 2026,
    directionId: { in: query.directions },
  };
  const payrollWhere = {
    ...baseWhere,
    source: { key: "local-payroll-xlsx" },
  };
  const [
    sales,
    costs,
    payroll,
    previousSales,
    previousCosts,
    previousPayroll,
    payrollSyncState,
    bitrixSyncState,
  ] = await Promise.all([
    prisma.salesMonthly.findMany({ where: { ...baseWhere, month: { in: months } } }),
    prisma.contractorCost.findMany({ where: { ...baseWhere, month: { in: months } } }),
    prisma.payrollMonthly.findMany({ where: { ...payrollWhere, month: { in: months } } }),
    priorMonths.length
      ? prisma.salesMonthly.findMany({ where: { ...baseWhere, month: { in: priorMonths } } })
      : Promise.resolve([]),
    priorMonths.length
      ? prisma.contractorCost.findMany({ where: { ...baseWhere, month: { in: priorMonths } } })
      : Promise.resolve([]),
    priorMonths.length
      ? prisma.payrollMonthly.findMany({ where: { ...payrollWhere, month: { in: priorMonths } } })
      : Promise.resolve([]),
    prisma.payrollSyncState.findFirst({
      where: { source: { key: "local-payroll-xlsx" } },
    }),
    prisma.bitrixSalesSyncState.findFirst({
      where: { source: { key: "bitrix24-sales" } },
    }),
  ]);

  const revenue = salesRevenue(sales);
  const contractors = contractorTotal(costs);
  const previousRevenue = salesRevenue(previousSales);
  const previousContractors = contractorTotal(previousCosts);
  const payrollValue = payrollTotals(payroll);
  const previousPayrollValue = payrollTotals(previousPayroll);
  const margin = revenue - contractors;
  const previousMargin = previousRevenue - previousContractors;
  const share = ratio(contractors, revenue);
  const previousShare = ratio(previousContractors, previousRevenue);

  const kpis: KpiValue[] = [
    metricKpi("revenue", "Выручка", revenue, null, previousRevenue || null, "currency"),
    metricKpi("contractors", "Подрядчики", contractors, null, previousContractors || null, "currency"),
    metricKpi(
      "payroll",
      "ФОТ",
      payroll.length ? payrollValue.total : null,
      null,
      previousPayroll.length ? previousPayrollValue.total : null,
      "currency",
      "Оклад, отпускные, премия и бонус от продаж",
    ),
    metricKpi("margin", "Маржа до ФОТ", margin, null, previousMargin || null, "currency"),
    metricKpi("share", "Доля подрядчиков", share, null, previousShare, "percent"),
  ];

  const latestPayrollPeriod =
    payrollSyncState?.latestYear && payrollSyncState.latestMonth
      ? `${payrollSyncState.latestYear}-${String(payrollSyncState.latestMonth).padStart(2, "0")}`
      : null;
  const revenueThrough = bitrixSyncState?.maxRevenueDate
    ?.toISOString()
    .slice(0, 10);
  const actualThrough = [latestPayrollPeriod, revenueThrough]
    .filter((value): value is string => Boolean(value))
    .sort()
    .at(-1) ?? null;

  const buckets = periodBuckets(months, query.granularity);
  const series: SeriesPoint[] = buckets.map((bucket) => {
    const periodPayroll = payrollTotals(
      payroll.filter((row) => bucket.months.includes(row.month)),
    );
    return {
      key: bucket.key,
      label: bucket.label,
      revenue: salesRevenue(sales.filter((row) => bucket.months.includes(row.month))),
      contractorCost: contractorTotal(costs.filter((row) => bucket.months.includes(row.month))),
      payroll: periodPayroll.total,
      payrollSalary: periodPayroll.salary,
      payrollVacationPay: periodPayroll.vacationPay,
      payrollBonus: periodPayroll.bonus,
      payrollSalesBonus: periodPayroll.salesBonus,
    };
  });

  const rows: RevenueRow[] = DIRECTIONS.filter((direction) =>
    query.directions.includes(direction.id),
  ).map((direction) => {
    const directionRevenue = salesRevenue(
      sales.filter((row) => row.directionId === direction.id),
    );
    const directionCost = contractorTotal(
      costs.filter((row) => row.directionId === direction.id),
    );
    const directionPayroll = payrollTotals(
      payroll.filter((row) => row.directionId === direction.id),
    );
    const contractorShare = ratio(directionCost, directionRevenue);
    return {
      directionId: direction.id,
      direction: direction.name,
      revenue: directionRevenue,
      contractorCost: directionCost,
      payroll: directionPayroll.total,
      payrollSalary: directionPayroll.salary,
      payrollVacationPay: directionPayroll.vacationPay,
      payrollBonus: directionPayroll.bonus,
      payrollSalesBonus: directionPayroll.salesBonus,
      margin: directionRevenue - directionCost,
      contractorShare,
      overLimit:
        contractorShare !== null &&
        contractorShare > env.contractorShareLimit,
    };
  });

  return {
    meta: {
      ...commonMeta("revenue", query, {
        actualThrough,
        lastSyncAt:
          bitrixSyncState?.lastSuccessAt ??
          payrollSyncState?.lastSuccessAt ??
          null,
      }),
      notice: [
        bitrixSyncState?.lastSuccessAt
          ? "Bitrix24 обновляет только выручку; ФОТ и подрядчики берутся из отдельных источников Atlas."
          : "Выручка Bitrix24 ещё не синхронизирована.",
        payrollSyncState?.lastSuccessAt
          ? null
          : "Начисления ФОТ ещё не синхронизированы.",
      ]
        .filter(Boolean)
        .join(" ") || undefined,
    },
    kpis,
    series,
    rows,
    contractorShareLimit: env.contractorShareLimit,
  };
}

type CashFlowTransaction = FintabloTransaction & {
  category: { externalId: string; name: string } | null;
  direction: { externalId: string; name: string } | null;
};

function flowTotal(
  rows: CashFlowTransaction[],
  group: "income" | "outcome",
) {
  return sum(
    rows
      .filter((row) => row.group === group)
      .map((row) => row.amount.toNumber()),
  );
}

function cashFlowDirectionId(
  row: CashFlowTransaction,
): CashFlowDirectionId {
  if (!row.direction) return CASH_FLOW_GENERAL_DIRECTION.id;
  return (
    DIRECTION_BY_SOURCE_NAME.get(row.direction.name) ??
    CASH_FLOW_GENERAL_DIRECTION.id
  );
}

function effectiveCashFlowTransactions(rows: CashFlowTransaction[]) {
  const splitParents = new Set(
    rows
      .map((row) => row.parentExternalId)
      .filter((id): id is string => Boolean(id)),
  );
  return rows.filter(
    (row) =>
      !row.isPlan &&
      row.group !== "transfer" &&
      !splitParents.has(row.externalId),
  );
}

function inMonths(row: CashFlowTransaction, months: number[]) {
  return (
    row.date.getUTCFullYear() === 2026 &&
    months.includes(row.date.getUTCMonth() + 1)
  );
}

function cashFlowCategory(row: CashFlowTransaction) {
  return row.category
    ? {
        key: `category:${row.category.externalId}`,
        label: row.category.name,
      }
    : { key: "category:unknown", label: "Без статьи" };
}

async function cashFlowDashboard(
  query: DashboardQuery,
): Promise<DashboardResponse> {
  const months = selectedMonths(query);
  const priorMonths = previousMonths(months);
  const [storedEntries, syncState] = await Promise.all([
    prisma.fintabloTransaction.findMany({
      where: {
        source: { key: "fintablo-cash-flow" },
        isPlan: false,
      },
      include: {
        category: { select: { externalId: true, name: true } },
        direction: { select: { externalId: true, name: true } },
      },
    }),
    prisma.fintabloCashFlowSyncState.findFirst({
      where: { source: { key: "fintablo-cash-flow" } },
    }),
  ]);
  const effectiveEntries = effectiveCashFlowTransactions(storedEntries);
  const selectedDirections = new Set(query.directions);
  const entries = effectiveEntries.filter(
    (row) =>
      inMonths(row, months) &&
      selectedDirections.has(cashFlowDirectionId(row)),
  );
  const previousEntries = effectiveEntries.filter(
    (row) =>
      inMonths(row, priorMonths) &&
      selectedDirections.has(cashFlowDirectionId(row)),
  );
  const income = flowTotal(entries, "income");
  const expense = flowTotal(entries, "outcome");
  const previousIncome = flowTotal(previousEntries, "income");
  const previousExpense = flowTotal(previousEntries, "outcome");
  const profitability = ratio(income - expense, income);
  const previousProfitability = ratio(
    previousIncome - previousExpense,
    previousIncome,
  );
  const hasPrevious = previousEntries.length > 0;

  const kpis: KpiValue[] = [
    metricKpi(
      "income",
      "Приход",
      income,
      null,
      hasPrevious ? previousIncome : null,
      "currency",
    ),
    metricKpi(
      "expense",
      "Расход",
      expense,
      null,
      hasPrevious ? previousExpense : null,
      "currency",
    ),
    metricKpi(
      "net",
      "Чистый поток",
      income - expense,
      null,
      hasPrevious ? previousIncome - previousExpense : null,
      "currency",
    ),
    {
      key: "profitability",
      label: "Рентабельность",
      value: profitability,
      delta:
        profitability !== null && previousProfitability !== null
          ? profitability - previousProfitability
          : null,
      deltaMode: "percentage-points",
      format: "percent",
    },
  ];

  const expenseByCategory = new Map<
    string,
    { key: string; label: string; value: number }
  >();
  for (const entry of entries.filter((row) => row.group === "outcome")) {
    const category = cashFlowCategory(entry);
    const current = expenseByCategory.get(category.key);
    expenseByCategory.set(category.key, {
      ...category,
      value: (current?.value ?? 0) + entry.amount.toNumber(),
    });
  }
  const sortedCategories = [...expenseByCategory.values()].sort(
    (left, right) =>
      right.value - left.value || left.label.localeCompare(right.label, "ru"),
  );
  const leadingCategories = sortedCategories.slice(0, 5);
  const otherValue = sum(
    sortedCategories.slice(5).map((category) => category.value),
  );
  const breakdown = [
    ...leadingCategories,
    ...(otherValue > 0
      ? [{ key: "other", label: "Прочее", value: otherValue }]
      : []),
  ];

  const leadingKeys = new Set(leadingCategories.map((item) => item.key));
  const buckets = periodBuckets(months, query.granularity);
  const series: SeriesPoint[] = buckets.map((bucket) => {
    const point: SeriesPoint = {
      key: bucket.key,
      label: bucket.label,
    };
    for (const category of breakdown) point[category.key] = 0;
    for (const entry of entries.filter(
      (row) =>
        row.group === "outcome" &&
        bucket.months.includes(row.date.getUTCMonth() + 1),
    )) {
      const category = cashFlowCategory(entry);
      const key = leadingKeys.has(category.key) ? category.key : "other";
      if (key in point) {
        point[key] = Number(point[key] ?? 0) + entry.amount.toNumber();
      }
    }
    return point;
  });

  const rows: CashFlowRow[] = CASH_FLOW_DIRECTIONS.filter((direction) =>
    query.directions.includes(direction.id),
  ).map((direction) => {
    const directionEntries = entries.filter(
      (entry) => cashFlowDirectionId(entry) === direction.id,
    );
    const directionIncome = flowTotal(directionEntries, "income");
    const directionExpense = flowTotal(directionEntries, "outcome");
    return {
      directionId: direction.id,
      direction: direction.name,
      income: directionIncome,
      expense: directionExpense,
      net: directionIncome - directionExpense,
      profitability: ratio(
        directionIncome - directionExpense,
        directionIncome,
      ),
    };
  });

  return {
    meta: {
      ...commonMeta("cash-flow", query, {
        actualThrough:
          syncState?.maxDate?.toISOString().slice(0, 10) ?? null,
        lastSyncAt: syncState?.lastSuccessAt ?? null,
      }),
      notice: syncState?.lastSuccessAt
        ? undefined
        : "Фактический ДДС FinTablo ещё не синхронизирован.",
    },
    kpis,
    series,
    rows,
    breakdown,
  };
}

function salesTotals(rows: SalesMonthly[]) {
  return {
    leads: sum(rows.map((row) => row.leads)),
    meetings: sum(rows.map((row) => row.meetings)),
    proposals: sum(rows.map((row) => row.proposals)),
    contracts: sum(rows.map((row) => row.contracts)),
    payments: sum(rows.map((row) => row.payments)),
    revenue: salesRevenue(rows),
  };
}

async function salesDashboard(
  query: DashboardQuery,
): Promise<DashboardResponse> {
  const months = selectedMonths(query);
  const priorMonths = previousMonths(months);
  const baseWhere = {
    year: 2026,
    directionId: { in: query.directions },
  };
  const [sales, previousSales, syncState] = await Promise.all([
    prisma.salesMonthly.findMany({ where: { ...baseWhere, month: { in: months } } }),
    priorMonths.length
      ? prisma.salesMonthly.findMany({ where: { ...baseWhere, month: { in: priorMonths } } })
      : Promise.resolve([]),
    prisma.bitrixSalesSyncState.findFirst({
      where: { source: { key: "bitrix24-sales" } },
    }),
  ]);
  const totals = salesTotals(sales);
  const previous = salesTotals(previousSales);
  const hasPrevious = previousSales.length > 0;
  const conversion = ratio(totals.payments, totals.leads);
  const previousConversion = ratio(previous.payments, previous.leads);

  const kpis: KpiValue[] = [
    metricKpi("leads", "Лиды", totals.leads, null, hasPrevious ? previous.leads : null, "integer"),
    metricKpi("contracts", "Договоры", totals.contracts, null, hasPrevious ? previous.contracts : null, "integer"),
    metricKpi("payments", "Оплаты", totals.payments, null, hasPrevious ? previous.payments : null, "integer"),
    metricKpi("conversion", "Лид → оплата", conversion, null, hasPrevious ? previousConversion : null, "percent"),
    metricKpi("revenue", "Выручка", totals.revenue, null, hasPrevious ? previous.revenue : null, "currency"),
  ];

  const buckets = periodBuckets(months, query.granularity);
  const series: SeriesPoint[] = buckets.map((bucket) => {
    const values = salesTotals(
      sales.filter((row) => bucket.months.includes(row.month)),
    );
    return {
      key: bucket.key,
      label: bucket.label,
      leads: values.leads,
      meetings: values.meetings,
      proposals: values.proposals,
      contracts: values.contracts,
      payments: values.payments,
    };
  });

  const rows: SalesRow[] = DIRECTIONS.filter((direction) =>
    query.directions.includes(direction.id),
  ).map((direction) => {
    const values = salesTotals(
      sales.filter((row) => row.directionId === direction.id),
    );
    return {
      directionId: direction.id,
      direction: direction.name,
      ...values,
    };
  });

  return {
    meta: {
      ...commonMeta("sales", query, {
        actualThrough:
          syncState?.maxDealDate?.toISOString().slice(0, 10) ?? null,
        lastSyncAt: syncState?.lastSuccessAt ?? null,
      }),
      notice: syncState?.lastSuccessAt
        ? "Воронка построена по дате создания и текущей достигнутой стадии сделки. Выручка распределена по дате закрытия."
        : "Продажи Bitrix24 ещё не синхронизированы.",
    },
    kpis,
    series,
    rows,
    funnel: [
      { key: "leads", label: "Лиды", value: totals.leads },
      { key: "meetings", label: "Встречи", value: totals.meetings },
      { key: "proposals", label: "КП", value: totals.proposals },
      { key: "contracts", label: "Договоры", value: totals.contracts },
      { key: "payments", label: "Оплаты", value: totals.payments },
    ],
  };
}

const FINTABLO_VAT_DIVISOR = 1.22;

function managementMetric(
  input: Omit<ManagementMetric, "normDelta" | "scaleMax">,
): ManagementMetric {
  const normDelta =
    input.value === null
      ? null
      : input.normDeltaMode === "percentage-points"
        ? input.value - input.norm
        : input.normDirection === "lower"
          ? (input.norm - input.value) / input.norm
          : (input.value - input.norm) / input.norm;
  return {
    ...input,
    normDelta,
    scaleMax: Math.max(
      input.norm * 1.4,
      input.value === null ? 0 : input.value * 1.2,
      1,
    ),
  };
}

async function managementDashboard(
  query: DashboardQuery,
): Promise<DashboardResponse> {
  const months = selectedMonths(query);
  const baseWhere = {
    year: 2026,
    directionId: { in: query.directions },
    month: { in: months },
  };
  const from = new Date(Date.UTC(2026, (months[0] ?? 1) - 1, 1));
  const to = new Date(
    Date.UTC(2026, months[months.length - 1] ?? 1, 1),
  );
  const [
    marketing,
    sales,
    costs,
    storedEntries,
    marketingSyncState,
    bitrixSyncState,
    fintabloSyncState,
    norms,
  ] = await Promise.all([
    prisma.marketingActual.findMany({
      where: {
        directionId: { in: query.directions },
        date: { gte: from, lt: to },
      },
    }),
    prisma.salesMonthly.findMany({ where: baseWhere }),
    prisma.contractorCost.findMany({ where: baseWhere }),
    prisma.fintabloTransaction.findMany({
      where: {
        source: { key: "fintablo-cash-flow" },
        isPlan: false,
        date: { gte: from, lt: to },
      },
      include: {
        category: { select: { externalId: true, name: true } },
        direction: { select: { externalId: true, name: true } },
      },
    }),
    prisma.marketingActualSyncState.findFirst({
      orderBy: { updatedAt: "desc" },
    }),
    prisma.bitrixSalesSyncState.findFirst({
      where: { source: { key: "bitrix24-sales" } },
    }),
    prisma.fintabloCashFlowSyncState.findFirst({
      where: { source: { key: "fintablo-cash-flow" } },
    }),
    getDashboardNorms(),
  ]);

  const selectedDirections = new Set(query.directions);
  const allBusinessDirectionsSelected = DIRECTIONS.every((direction) =>
    selectedDirections.has(direction.id),
  );
  const cashEntries = effectiveCashFlowTransactions(storedEntries).filter(
    (row) => {
      const directionId = cashFlowDirectionId(row);
      return (
        selectedDirections.has(directionId) ||
        (allBusinessDirectionsSelected &&
          directionId === CASH_FLOW_GENERAL_DIRECTION.id)
      );
    },
  );
  const marketingBudget = sum(
    marketing.map((row) => row.budget.toNumber()),
  );
  const marketingLeads = sum(marketing.map((row) => row.leads));
  const revenue = salesRevenue(sales);
  const payments = sum(sales.map((row) => row.payments));
  const grossProfit = revenue - contractorTotal(costs);
  const receiptsWithVat = flowTotal(cashEntries, "income");
  const receiptsWithoutVat = receiptsWithVat / FINTABLO_VAT_DIVISOR;

  const managementMetrics: ManagementMetric[] = [
    managementMetric({
      key: "roas",
      label: "ROAS",
      value:
        sales.length && marketing.length
          ? ratio(revenue, marketingBudget)
          : null,
      norm: norms.roas,
      normDirection: "higher",
      normDeltaMode: "relative",
      format: "decimal",
      hint:
        "Выручка / фактический рекламный бюджет. Показывает, сколько рублей выручки принёс один рубль рекламы.",
      source: "Выручка и ФОТ + Маркетинг",
    }),
    managementMetric({
      key: "cac",
      label: "CAC",
      value:
        sales.length && marketing.length
          ? ratio(marketingBudget, payments)
          : null,
      norm: norms.cac,
      normDirection: "lower",
      normDeltaMode: "relative",
      format: "currency",
      hint:
        "Фактический рекламный бюджет / число фактически полученных оплат. Чем ниже значение, тем лучше.",
      source: "Маркетинг + Продажи",
    }),
    managementMetric({
      key: "gross-profit-per-lead",
      label: "Валовая прибыль на 1 лида",
      value:
        sales.length && marketing.length
          ? ratio(grossProfit, marketingLeads)
          : null,
      norm: norms.grossProfitPerLead,
      normDirection: "higher",
      normDeltaMode: "relative",
      format: "currency",
      hint:
        "(Выручка − затраты на подрядчиков) / фактически полученные лиды.",
      source: "Выручка и ФОТ + Маркетинг",
    }),
    managementMetric({
      key: "cash-conversion",
      label: "Cash Conversion",
      value:
        sales.length && cashEntries.length
          ? ratio(receiptsWithoutVat, revenue)
          : null,
      norm: norms.cashConversion,
      normDirection: "higher",
      normDeltaMode: "percentage-points",
      format: "percent",
      hint:
        "(Поступления FinTablo / 1,22) / выручка × 100%. Коррекция НДС применяется только в этом показателе.",
      source: "ДДС + Выручка и ФОТ",
    }),
  ];

  const coverageDates = [
    marketingSyncState?.maxDate,
    bitrixSyncState?.maxRevenueDate,
    fintabloSyncState?.maxDate,
  ]
    .filter((value): value is Date => Boolean(value))
    .sort((left, right) => left.getTime() - right.getTime());
  const syncDates = [
    marketingSyncState?.lastSuccessAt,
    bitrixSyncState?.lastSuccessAt,
    fintabloSyncState?.lastSuccessAt,
  ]
    .filter((value): value is Date => Boolean(value))
    .sort((left, right) => right.getTime() - left.getTime());
  const missingData = [
    marketing.length ? null : "Маркетинговый факт за период отсутствует.",
    sales.length ? null : "Выручка и оплаты за период отсутствуют.",
    cashEntries.length ? null : "Поступления FinTablo за период отсутствуют.",
  ].filter((value): value is string => Boolean(value));

  return {
    meta: {
      ...commonMeta("dashboards", query, {
        actualThrough: coverageDates[0]?.toISOString().slice(0, 10) ?? null,
        lastSyncAt: syncDates[0] ?? null,
      }),
      notice: [
        "Cash Conversion рассчитан без НДС: поступления FinTablo разделены на 1,22.",
        ...missingData,
      ].join(" "),
    },
    kpis: [],
    series: [],
    rows: [],
    managementMetrics,
    managementInputs: {
      revenue,
      marketingBudget,
      payments,
      grossProfit,
      marketingLeads,
      receiptsWithVat,
      receiptsWithoutVat,
    },
  };
}

export async function getDashboard(
  section: DashboardSection,
  query: DashboardQuery,
): Promise<DashboardResponse> {
  switch (section) {
    case "marketing":
      return marketingDashboard(query);
    case "revenue":
      return revenueDashboard(query);
    case "cash-flow":
      return cashFlowDashboard(query);
    case "sales":
      return salesDashboard(query);
    case "dashboards":
      return managementDashboard(query);
  }
}

export function formatPeriodForNotice(key: string) {
  const month = monthFromKey(key);
  return Number.isFinite(month) ? `${MONTHS[month - 1]} 2026` : key;
}
