import { Prisma } from "@prisma/client";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  prisma: {
    fintabloTransaction: { findMany: vi.fn() },
    fintabloCashFlowSyncState: { findFirst: vi.fn() },
  },
}));

vi.mock("@/lib/prisma", () => ({ prisma: mocks.prisma }));

import { getDashboard } from "@/services/dashboard";

type TransactionInput = {
  externalId: string;
  amount: number;
  group: string;
  date: string;
  categoryId?: string;
  categoryName?: string;
  directionName?: string | null;
  parentExternalId?: string | null;
  isPlan?: boolean;
};

function transaction(input: TransactionInput) {
  const categoryId = input.categoryId ?? "income";
  return {
    id: `internal-${input.externalId}`,
    sourceId: "source-fintablo",
    externalId: input.externalId,
    parentExternalId: input.parentExternalId ?? null,
    parentId: null,
    categoryExternalId: categoryId,
    categoryId: `category-${categoryId}`,
    directionExternalId:
      input.directionName === null ? null : `direction-${input.directionName}`,
    directionId:
      input.directionName === null ? null : `direction-${input.directionName}`,
    moneybagExternalId: null,
    moneybag2ExternalId: null,
    group: input.group,
    amount: new Prisma.Decimal(input.amount),
    amount2: null,
    description: null,
    date: new Date(`${input.date}T00:00:00.000Z`),
    timestamp: BigInt(0),
    isPlan: input.isPlan ?? false,
    raw: {},
    createdAt: new Date("2026-09-08T00:00:00.000Z"),
    updatedAt: new Date("2026-09-08T00:00:00.000Z"),
    category: {
      externalId: categoryId,
      name: input.categoryName ?? categoryId,
    },
    direction:
      input.directionName === null
        ? null
        : {
            externalId: `direction-${input.directionName}`,
            name: input.directionName ?? "Брендинг",
          },
  };
}

const entries = [
  transaction({
    externalId: "previous-income",
    amount: 200,
    group: "income",
    date: "2026-04-10",
    directionName: "Брендинг",
  }),
  transaction({
    externalId: "previous-expense",
    amount: 100,
    group: "outcome",
    date: "2026-04-11",
    categoryId: "previous",
    categoryName: "Предыдущий расход",
    directionName: "Брендинг",
  }),
  transaction({
    externalId: "split-parent",
    amount: 1_000,
    group: "income",
    date: "2026-06-01",
    directionName: "Брендинг",
  }),
  transaction({
    externalId: "split-child-1",
    parentExternalId: "split-parent",
    amount: 400,
    group: "income",
    date: "2026-06-01",
    directionName: "Брендинг",
  }),
  transaction({
    externalId: "split-child-2",
    parentExternalId: "split-parent",
    amount: 600,
    group: "income",
    date: "2026-06-01",
    directionName: "Брендинг",
  }),
  ...[70, 60, 50, 40, 30, 20].map((amount, index) =>
    transaction({
      externalId: `expense-${index + 1}`,
      amount,
      group: "outcome",
      date: index % 2 === 0 ? "2026-06-15" : "2026-07-15",
      categoryId: `category-${index + 1}`,
      categoryName: `Статья ${index + 1}`,
      directionName: "Брендинг",
    }),
  ),
  transaction({
    externalId: "general-expense",
    amount: 10,
    group: "outcome",
    date: "2026-07-20",
    categoryId: "category-7",
    categoryName: "Статья 7",
    directionName: "Неизвестное направление",
  }),
  transaction({
    externalId: "planned-income",
    amount: 9_999,
    group: "income",
    date: "2026-06-20",
    directionName: "Брендинг",
    isPlan: true,
  }),
  transaction({
    externalId: "transfer",
    amount: 9_999,
    group: "transfer",
    date: "2026-06-20",
    directionName: "Брендинг",
  }),
];

describe("ДДС FinTablo", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.prisma.fintabloTransaction.findMany.mockResolvedValue(entries);
    mocks.prisma.fintabloCashFlowSyncState.findFirst.mockResolvedValue({
      maxDate: new Date("2026-07-20T00:00:00.000Z"),
      lastSuccessAt: new Date("2026-09-08T10:00:00.000Z"),
    });
  });

  it("считает факт без планов, переводов и родителя разбитого платежа", async () => {
    const dashboard = await getDashboard("cash-flow", {
      from: "2026-06",
      to: "2026-07",
      granularity: "month",
      directions: ["branding", "general"],
    });

    expect(dashboard.kpis).toEqual([
      expect.objectContaining({ key: "income", value: 1_000 }),
      expect.objectContaining({ key: "expense", value: 280 }),
      expect.objectContaining({ key: "net", value: 720 }),
      expect.objectContaining({
        key: "profitability",
        value: 0.72,
        deltaMode: "percentage-points",
      }),
    ]);
    expect(
      dashboard.kpis.find((kpi) => kpi.key === "profitability")?.delta,
    ).toBeCloseTo(0.22);
    expect(dashboard.meta).toMatchObject({
      actualThrough: "2026-07-20",
      lastSyncAt: "2026-09-08T10:00:00.000Z",
    });
  });

  it("строит Top-5 и временной ряд по одному набору ключей", async () => {
    const dashboard = await getDashboard("cash-flow", {
      from: "2026-06",
      to: "2026-07",
      granularity: "month",
      directions: ["branding", "general"],
    });

    expect(dashboard.breakdown).toEqual([
      expect.objectContaining({ key: "category:category-1", value: 70 }),
      expect.objectContaining({ key: "category:category-2", value: 60 }),
      expect.objectContaining({ key: "category:category-3", value: 50 }),
      expect.objectContaining({ key: "category:category-4", value: 40 }),
      expect.objectContaining({ key: "category:category-5", value: 30 }),
      { key: "other", label: "Прочее", value: 30 },
    ]);
    const breakdownKeys = dashboard.breakdown?.map(({ key }) => key) ?? [];
    for (const point of dashboard.series) {
      expect(breakdownKeys.every((key) => key in point)).toBe(true);
    }
    expect(
      dashboard.series.reduce(
        (total, point) =>
          total +
          breakdownKeys.reduce(
            (periodTotal, key) => periodTotal + Number(point[key] ?? 0),
            0,
          ),
        0,
      ),
    ).toBe(280);
  });

  it("относит неизвестное направление к общему и не делит на ноль", async () => {
    const dashboard = await getDashboard("cash-flow", {
      from: "2026-06",
      to: "2026-07",
      granularity: "month",
      directions: ["general"],
    });

    expect(dashboard.kpis).toEqual([
      expect.objectContaining({ key: "income", value: 0 }),
      expect.objectContaining({ key: "expense", value: 10 }),
      expect.objectContaining({ key: "net", value: -10 }),
      expect.objectContaining({ key: "profitability", value: null, delta: null }),
    ]);
    expect(dashboard.rows).toEqual([
      expect.objectContaining({
        directionId: "general",
        income: 0,
        expense: 10,
        profitability: null,
      }),
    ]);
  });
});
