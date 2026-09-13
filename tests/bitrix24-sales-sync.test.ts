import { Prisma } from "@prisma/client";
import { describe, expect, it } from "vitest";

import type {
  Bitrix24Deal,
  Bitrix24Funnel,
  Bitrix24SalesSnapshot,
  Bitrix24StageSemantics,
} from "@/services/bitrix24-client";
import { aggregateBitrixSales } from "@/services/bitrix24-sales-sync";

const directionFunnels = [
  [2, "Разработка сайтов"],
  [4, "SMM"],
  [6, "Брендинг"],
  [8, "Рекламные кампании"],
  [12, "Видеоконтент"],
] as const;

function stages(categoryId: number) {
  const prefix = `C${categoryId}:`;
  const stage = (
    id: string,
    name: string,
    semantics: Bitrix24StageSemantics,
    sort: number,
  ) => ({ id: `${prefix}${id}`, name, semantics, sort });
  return [
    stage("NEW", "Новый лид", "process", 10),
    stage("PREPARATION", "Встреча проведена", "process", 20),
    stage("PREPAYMENT_INVOICE", "КП выставлено", "process", 30),
    stage("EXECUTING", "Договор подписан", "process", 40),
    stage("WON", "Оплачено", "success", 50),
    stage("LOSE", "Сделка провалена", "failure", 60),
  ];
}

function funnels(): Bitrix24Funnel[] {
  return [
    {
      id: 0,
      name: "Общая воронка",
      isDefault: true,
      stages: [],
    },
    ...directionFunnels.map(([id, name]) => ({
      id,
      name,
      isDefault: false,
      stages: stages(id),
    })),
  ];
}

function deal(
  id: string,
  stageId: string,
  overrides: Partial<Bitrix24Deal> = {},
): Bitrix24Deal {
  return {
    id,
    categoryId: 6,
    stageId: `C6:${stageId}`,
    opportunity: new Prisma.Decimal("0"),
    currencyId: "RUB",
    createdDate: "2026-08-21",
    closedDate: null,
    ...overrides,
  };
}

function snapshot(deals: Bitrix24Deal[]): Bitrix24SalesSnapshot {
  return {
    funnels: funnels(),
    deals,
    receivedAt: new Date("2026-09-14T00:00:00.000Z"),
  };
}

describe("агрегация продаж Bitrix24", () => {
  it("строит когорту по созданию, а выручку — по закрытию", () => {
    const aggregate = aggregateBitrixSales(
      snapshot([
        deal("1", "NEW"),
        deal("2", "LOSE"),
        deal("3", "EXECUTING"),
        deal("4", "WON", {
          opportunity: new Prisma.Decimal("100.10"),
          closedDate: "2026-09-03",
        }),
        deal("5", "IGNORED", {
          categoryId: 0,
          stageId: "NEW",
        }),
      ]),
    );

    expect(aggregate).toMatchObject({
      dealCount: 5,
      funnelCount: 5,
      ignoredDealCount: 1,
    });
    expect(aggregate.minDealDate?.toISOString().slice(0, 10)).toBe(
      "2026-08-21",
    );
    expect(aggregate.maxRevenueDate?.toISOString().slice(0, 10)).toBe(
      "2026-09-03",
    );

    const august = aggregate.rows.find(
      (row) => row.month === 8 && row.directionId === "branding",
    );
    expect(august).toMatchObject({
      leads: 4,
      meetings: 2,
      proposals: 2,
      contracts: 2,
      payments: 1,
    });
    expect(august?.revenue.toFixed(2)).toBe("0.00");

    const september = aggregate.rows.find(
      (row) => row.month === 9 && row.directionId === "branding",
    );
    expect(september).toMatchObject({
      leads: 0,
      meetings: 0,
      proposals: 0,
      contracts: 0,
      payments: 0,
    });
    expect(september?.revenue.toFixed(2)).toBe("100.10");
  });

  it("не смешивает валюты без настроенного курса", () => {
    expect(() =>
      aggregateBitrixSales(
        snapshot([
          deal("1", "WON", {
            opportunity: new Prisma.Decimal("10"),
            currencyId: "USD",
            closedDate: "2026-09-03",
          }),
        ]),
      ),
    ).toThrow("курс пересчёта в RUB не настроен");
  });
});
