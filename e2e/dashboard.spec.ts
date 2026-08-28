import { expect, test } from "@playwright/test";

const dashboardFixture = {
  meta: {
    section: "marketing",
    from: "2026-01",
    to: "2026-08",
    granularity: "month",
    directions: ["branding", "web-development"],
    actualThrough: "2026-08",
    planThrough: "2026-12",
    lastSyncAt: "2026-08-28T17:00:00.000Z",
  },
  kpis: [
    {
      key: "budget",
      label: "Бюджет",
      value: 1_250_000,
      plan: 1_300_000,
      delta: 0.04,
      completion: 0.962,
      format: "currency",
    },
    {
      key: "leads",
      label: "Лиды",
      value: 390,
      plan: 410,
      delta: 0.07,
      completion: 0.951,
      format: "integer",
    },
  ],
  series: [
    {
      key: "2026-01",
      label: "Янв",
      planBudget: 620_000,
      actualBudget: 590_000,
      revenue: 4_200_000,
      contractorCost: 1_600_000,
      income: 4_200_000,
      expense: 3_100_000,
      net: 1_100_000,
      leads: 180,
      meetings: 110,
      proposals: 78,
      contracts: 42,
      payments: 34,
    },
    {
      key: "2026-02",
      label: "Фев",
      planBudget: 680_000,
      actualBudget: 660_000,
      revenue: 4_700_000,
      contractorCost: 1_800_000,
      income: 4_700_000,
      expense: 3_400_000,
      net: 1_300_000,
      leads: 210,
      meetings: 129,
      proposals: 91,
      contracts: 48,
      payments: 39,
    },
  ],
  rows: [
    {
      directionId: "branding",
      direction: "Брендинг",
      planBudget: 500_000,
      actualBudget: 480_000,
      planVisits: 5_000,
      actualVisits: 4_900,
      planLeads: 130,
      actualLeads: 128,
      planConversion: 0.026,
      actualConversion: 0.0261,
      planCpc: 100,
      actualCpc: 97.96,
      planCpl: 3_846,
      actualCpl: 3_750,
    },
  ],
  funnel: [
    { key: "leads", label: "Лиды", value: 390 },
    { key: "meetings", label: "Встречи", value: 239 },
    { key: "proposals", label: "КП", value: 169 },
    { key: "contracts", label: "Договоры", value: 90 },
    { key: "payments", label: "Оплаты", value: 73 },
  ],
  breakdown: [
    { key: "Подрядчики", label: "Подрядчики", value: 1_800_000 },
    { key: "Команда", label: "Команда", value: 800_000 },
  ],
  contractorShareLimit: 0.4,
};

test.beforeEach(async ({ page }) => {
  await page.route("**/api/sync/marketing-plan", async (route) => {
    if (route.request().method() === "POST") {
      await route.fulfill({
        contentType: "application/json",
        body: JSON.stringify({
          status: "SUCCESS",
          changed: false,
          message: "Изменений в маркетинговом плане нет.",
        }),
      });
      return;
    }
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        lastRun: {
          status: "SUCCESS",
          finishedAt: "2026-08-28T17:00:00.000Z",
          errorMessage: null,
        },
        snapshot: {
          createdAt: "2026-08-28T17:00:00.000Z",
          rowCount: 60,
        },
      }),
    });
  });

  await page.route("**/api/dashboard/**", async (route) => {
    const section = new URL(route.request().url()).pathname.split("/").at(-1);
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        ...dashboardFixture,
        meta: { ...dashboardFixture.meta, section },
      }),
    });
  });
});

test("открывает четыре раздела и сохраняет общий интерфейс", async ({ page }) => {
  await page.goto("/");
  await expect(
    page.getByRole("heading", { name: "Маркетинг", exact: true }),
  ).toBeVisible();
  await expect(page.getByRole("tab")).toHaveCount(4);
  await expect(
    page.getByRole("button", { name: "Синхронизировать маркетинговый план" }),
  ).toBeVisible();

  await page.getByRole("tab", { name: "Продажи" }).click();
  await expect(
    page.getByRole("heading", { name: "Продажи", exact: true }),
  ).toBeVisible();
  await expect(page.getByText("Воронка продаж")).toBeVisible();
});

test("показывает понятное состояние без направлений", async ({ page }) => {
  await page.goto("/");
  await page.getByText("Направления", { exact: true }).first().click();
  await page.getByRole("button", { name: "Сбросить все" }).click();
  await expect(
    page.getByRole("heading", { name: "Выберите хотя бы одно направление" }),
  ).toBeVisible();
});

test("переключает группировку и период", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Кварталы" }).click();
  await expect(page.getByRole("button", { name: "Кварталы" })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await page.getByText("Янв — Авг 2026").click();
  await page.getByRole("button", { name: "Прошлый квартал" }).click();
  await expect(page.getByText("Апр — Июн 2026")).toBeVisible();
});
