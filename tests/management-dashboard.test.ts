import { Prisma } from "@prisma/client";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  prisma: {
    marketingActual: { findMany: vi.fn() },
    salesMonthly: { findMany: vi.fn() },
    contractorCost: { findMany: vi.fn() },
    fintabloTransaction: { findMany: vi.fn() },
    marketingActualSyncState: { findFirst: vi.fn() },
    bitrixSalesSyncState: { findFirst: vi.fn() },
    fintabloCashFlowSyncState: { findFirst: vi.fn() },
  },
  getDashboardNorms: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({ prisma: mocks.prisma }));
vi.mock("@/services/dashboard-norms", () => ({
  getDashboardNorms: mocks.getDashboardNorms,
}));

import { getDashboard } from "@/services/dashboard";

function income(externalId: string, amount: number, directionName: string) {
  return {
    id: `internal-${externalId}`,
    sourceId: "fintablo",
    externalId,
    parentExternalId: null,
    categoryId: null,
    categoryExternalId: null,
    directionId: `direction-${externalId}`,
    directionExternalId: `direction-${externalId}`,
    moneybagExternalId: "moneybag",
    moneybag2ExternalId: null,
    group: "income",
    amount: new Prisma.Decimal(amount),
    amount2: null,
    description: null,
    date: new Date("2026-07-15T00:00:00.000Z"),
    timestamp: BigInt(0),
    isPlan: false,
    raw: {},
    category: null,
    direction: { externalId: `direction-${externalId}`, name: directionName },
  };
}

const allDirections = [
  "branding",
  "web-development",
  "video-content",
  "smm",
  "ad-campaigns",
] as const;

describe("управленческий дашборд", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.prisma.marketingActual.findMany.mockResolvedValue([
      {
        date: new Date("2026-07-01T00:00:00.000Z"),
        directionId: "branding",
        visits: 100,
        leads: 10,
        budget: new Prisma.Decimal(1220),
      },
    ]);
    mocks.prisma.salesMonthly.findMany.mockResolvedValue([
      {
        year: 2026,
        month: 7,
        directionId: "branding",
        payments: 2,
        revenue: new Prisma.Decimal(24_400),
      },
    ]);
    mocks.prisma.contractorCost.findMany.mockResolvedValue([
      {
        year: 2026,
        month: 7,
        directionId: "branding",
        amount: new Prisma.Decimal(4_400),
      },
    ]);
    mocks.prisma.fintabloTransaction.findMany.mockResolvedValue([
      income("branding", 14_884, "Брендинг"),
      income("general", 14_884, "Общее"),
    ]);
    mocks.prisma.marketingActualSyncState.findFirst.mockResolvedValue({
      maxDate: new Date("2026-07-31T00:00:00.000Z"),
      lastSuccessAt: new Date("2026-09-14T10:00:00.000Z"),
    });
    mocks.prisma.bitrixSalesSyncState.findFirst.mockResolvedValue({
      maxRevenueDate: new Date("2026-07-30T00:00:00.000Z"),
      lastSuccessAt: new Date("2026-09-14T11:00:00.000Z"),
    });
    mocks.prisma.fintabloCashFlowSyncState.findFirst.mockResolvedValue({
      maxDate: new Date("2026-07-29T00:00:00.000Z"),
      lastSuccessAt: new Date("2026-09-14T12:00:00.000Z"),
    });
    mocks.getDashboardNorms.mockResolvedValue({
      roas: 12,
      cac: 700,
      grossProfitPerLead: 1800,
      cashConversion: 0.9,
      updatedAt: null,
    });
  });

  it("считает четыре показателя и убирает 22% НДС из поступлений", async () => {
    const dashboard = await getDashboard("dashboards", {
      from: "2026-07",
      to: "2026-07",
      granularity: "month",
      directions: [...allDirections],
    });

    expect(dashboard.managementMetrics?.slice(0, 3)).toEqual([
      expect.objectContaining({ key: "roas", value: 20, normDelta: 2 / 3 }),
      expect.objectContaining({
        key: "cac",
        value: 610,
        normDirection: "lower",
        normDelta: 90 / 700,
      }),
      expect.objectContaining({
        key: "gross-profit-per-lead",
        value: 2_000,
        normDelta: 200 / 1_800,
      }),
    ]);
    expect(dashboard.managementMetrics?.[3]).toMatchObject({
      key: "cash-conversion",
      value: 1,
      normDeltaMode: "percentage-points",
    });
    expect(dashboard.managementMetrics?.[3]?.normDelta).toBeCloseTo(0.1);
    expect(dashboard.series[0]).toMatchObject({
      key: "2026-07",
      roas: 20,
      cac: 610,
      "gross-profit-per-lead": 2_000,
      "cash-conversion": 1,
      managementRevenue: 24_400,
      managementMarketingBudget: 1_220,
    });
    expect(dashboard.managementInputs).toMatchObject({
      receiptsWithVat: 29_768,
      receiptsWithoutVat: 24_400,
    });
    expect(dashboard.meta.actualThrough).toBe("2026-07-29");
  });

  it("исключает общее ДДС при фильтрации отдельного направления", async () => {
    const dashboard = await getDashboard("dashboards", {
      from: "2026-07",
      to: "2026-07",
      granularity: "month",
      directions: ["branding"],
    });

    expect(
      dashboard.managementMetrics?.find(
        (metric) => metric.key === "cash-conversion",
      )?.value,
    ).toBe(0.5);
  });

  it("не выдаёт нули вместо метрик, если выручка и оплаты отсутствуют", async () => {
    mocks.prisma.salesMonthly.findMany.mockResolvedValue([]);

    const dashboard = await getDashboard("dashboards", {
      from: "2026-07",
      to: "2026-07",
      granularity: "month",
      directions: ["branding"],
    });

    expect(
      dashboard.managementMetrics?.every((metric) => metric.value === null),
    ).toBe(true);
    expect(dashboard.meta.notice).toContain(
      "Выручка и оплаты за период отсутствуют",
    );
  });
});
