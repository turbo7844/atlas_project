import { Prisma } from "@prisma/client";
import { beforeEach, describe, expect, it, vi } from "vitest";

const sales = [
  { year: 2026, month: 3, directionId: "branding", revenue: new Prisma.Decimal(800) },
  { year: 2026, month: 4, directionId: "branding", revenue: new Prisma.Decimal(1_000) },
  { year: 2026, month: 4, directionId: "web-development", revenue: new Prisma.Decimal(2_000) },
  { year: 2026, month: 5, directionId: "branding", revenue: new Prisma.Decimal(1_200) },
];
const costs = [
  { year: 2026, month: 3, directionId: "branding", amount: new Prisma.Decimal(80) },
  { year: 2026, month: 4, directionId: "branding", amount: new Prisma.Decimal(100) },
  { year: 2026, month: 4, directionId: "web-development", amount: new Prisma.Decimal(300) },
  { year: 2026, month: 5, directionId: "branding", amount: new Prisma.Decimal(120) },
];
const payroll = [
  {
    year: 2026,
    month: 3,
    directionId: "branding",
    salary: new Prisma.Decimal(80),
    vacationPay: new Prisma.Decimal(0),
    bonus: new Prisma.Decimal(10),
    salesBonus: new Prisma.Decimal(0),
  },
  {
    year: 2026,
    month: 4,
    directionId: "branding",
    salary: new Prisma.Decimal(100),
    vacationPay: new Prisma.Decimal(20),
    bonus: new Prisma.Decimal(30),
    salesBonus: new Prisma.Decimal(40),
  },
  {
    year: 2026,
    month: 4,
    directionId: "web-development",
    salary: new Prisma.Decimal(200),
    vacationPay: new Prisma.Decimal(0),
    bonus: new Prisma.Decimal(50),
    salesBonus: new Prisma.Decimal(10),
  },
  {
    year: 2026,
    month: 5,
    directionId: "branding",
    salary: new Prisma.Decimal(110),
    vacationPay: new Prisma.Decimal(0),
    bonus: new Prisma.Decimal(20),
    salesBonus: new Prisma.Decimal(0),
  },
  {
    year: 2026,
    month: 9,
    directionId: "branding",
    salary: new Prisma.Decimal(50),
    vacationPay: new Prisma.Decimal(5),
    bonus: new Prisma.Decimal(0),
    salesBonus: new Prisma.Decimal(0),
  },
];

function selectRows<Row extends { year: number; month: number; directionId: string }>(
  rows: Row[],
  args: {
    where: {
      year: number;
      month: { in: number[] };
      directionId: { in: string[] };
    };
  },
) {
  return rows.filter(
    (row) =>
      row.year === args.where.year &&
      args.where.month.in.includes(row.month) &&
      args.where.directionId.in.includes(row.directionId),
  );
}

const mocks = vi.hoisted(() => ({
  prisma: {
    salesMonthly: { findMany: vi.fn() },
    contractorCost: { findMany: vi.fn() },
    payrollMonthly: { findMany: vi.fn() },
    payrollSyncState: { findFirst: vi.fn() },
  },
}));

vi.mock("@/lib/prisma", () => ({ prisma: mocks.prisma }));

import { getDashboard } from "@/services/dashboard";

describe("ФОТ в разделе выручки", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.prisma.salesMonthly.findMany.mockImplementation((args) =>
      selectRows(sales, args),
    );
    mocks.prisma.contractorCost.findMany.mockImplementation((args) =>
      selectRows(costs, args),
    );
    mocks.prisma.payrollMonthly.findMany.mockImplementation((args) =>
      selectRows(payroll, args),
    );
    mocks.prisma.payrollSyncState.findFirst.mockResolvedValue({
      latestYear: 2026,
      latestMonth: 9,
      lastSuccessAt: new Date("2026-08-31T10:00:00.000Z"),
    });
  });

  it("учитывает фильтр направления и прошлый месячный период", async () => {
    const dashboard = await getDashboard("revenue", {
      from: "2026-04",
      to: "2026-04",
      granularity: "month",
      directions: ["branding"],
    });

    const payrollKpi = dashboard.kpis.find((kpi) => kpi.key === "payroll");
    expect(payrollKpi).toMatchObject({
      value: 190,
      delta: 190 / 90 - 1,
      format: "currency",
    });
    expect(dashboard.series).toEqual([
      expect.objectContaining({
        key: "2026-04",
        payroll: 190,
        payrollSalary: 100,
        payrollVacationPay: 20,
        payrollBonus: 30,
        payrollSalesBonus: 40,
      }),
    ]);
    expect(dashboard.rows).toEqual([
      expect.objectContaining({
        directionId: "branding",
        payroll: 190,
        margin: 900,
      }),
    ]);
  });

  it("суммирует компоненты по кварталу и выбранным направлениям", async () => {
    const dashboard = await getDashboard("revenue", {
      from: "2026-04",
      to: "2026-06",
      granularity: "quarter",
      directions: ["branding", "web-development"],
    });

    expect(dashboard.series).toHaveLength(1);
    expect(dashboard.series[0]).toMatchObject({
      key: "2026-Q2",
      payroll: 580,
      payrollSalary: 410,
      payrollVacationPay: 20,
      payrollBonus: 100,
      payrollSalesBonus: 50,
    });
    expect(dashboard.rows).toHaveLength(2);
  });

  it("показывает добавленные в XLSX месяцы после августа", async () => {
    const dashboard = await getDashboard("revenue", {
      from: "2026-09",
      to: "2026-09",
      granularity: "month",
      directions: ["branding"],
    });

    expect(dashboard.meta.actualThrough).toBe("2026-09");
    expect(dashboard.series[0]).toMatchObject({
      key: "2026-09",
      revenue: 0,
      contractorCost: 0,
      payroll: 55,
    });
  });
});
