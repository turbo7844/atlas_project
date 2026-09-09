import { expect, test } from "@playwright/test";

const fintabloStatus = {
  configured: true,
  status: "SUCCESS",
  revision: 1,
  lastSuccessAt: "2026-09-08T10:00:00.000Z",
  rowCount: 971,
  maxDate: "2026-08-31",
  error: null,
};

const cashFlowFixture = {
  meta: {
    section: "cash-flow",
    from: "2026-01",
    to: "2026-08",
    granularity: "month",
    directions: [
      "branding",
      "web-development",
      "video-content",
      "smm",
      "ad-campaigns",
      "general",
    ],
    actualThrough: "2026-08-31",
    planThrough: "2026-12",
    lastSyncAt: "2026-09-08T10:00:00.000Z",
  },
  kpis: [
    {
      key: "income",
      label: "Приход",
      value: 4_200_000,
      delta: 0.08,
      format: "currency",
    },
    {
      key: "expense",
      label: "Расход",
      value: 3_100_000,
      delta: 0.04,
      format: "currency",
    },
    {
      key: "net",
      label: "Чистый поток",
      value: 1_100_000,
      delta: 0.21,
      format: "currency",
    },
    {
      key: "profitability",
      label: "Рентабельность",
      value: 0.2619,
      delta: 0.032,
      deltaMode: "percentage-points",
      format: "percent",
    },
  ],
  breakdown: [
    { key: "category:11", label: "Подрядчики", value: 1_800_000 },
    { key: "category:12", label: "Команда", value: 800_000 },
    { key: "other", label: "Прочее", value: 500_000 },
  ],
  series: [
    {
      key: "2026-07",
      label: "Июл",
      "category:11": 850_000,
      "category:12": 390_000,
      other: 220_000,
    },
    {
      key: "2026-08",
      label: "Авг",
      "category:11": 950_000,
      "category:12": 410_000,
      other: 280_000,
    },
  ],
  rows: [
    {
      directionId: "branding",
      direction: "Брендинг",
      income: 3_800_000,
      expense: 2_900_000,
      net: 900_000,
      profitability: 0.2368,
    },
    {
      directionId: "general",
      direction: "Общее",
      income: 400_000,
      expense: 200_000,
      net: 200_000,
      profitability: 0.5,
    },
  ],
};

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem(
      "atlas-dashboard-filters",
      JSON.stringify({
        section: "cash-flow",
        directions: ["branding"],
        from: "2026-01",
        to: "2026-08",
        granularity: "month",
      }),
    );
  });

  await page.route("**/api/sync/fintablo-cash-flow", async (route) => {
    if (route.request().method() === "POST") {
      await route.fulfill({
        contentType: "application/json",
        body: JSON.stringify({
          status: "SUCCESS",
          changed: true,
          revision: 2,
          rowCount: 971,
          message: "Фактический ДДС FinTablo обновлён.",
        }),
      });
      return;
    }
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify(fintabloStatus),
    });
  });

  await page.route("**/api/updates/fintablo-cash-flow**", async (route) => {
    await route.fulfill({
      contentType: "text/event-stream",
      body: `event: fintablo-cash-flow\ndata: ${JSON.stringify({
        ...fintabloStatus,
        revision: 2,
        lastSuccessAt: "2026-09-08T10:01:00.000Z",
      })}\n\n`,
    });
  });

  await page.route("**/api/sync/marketing-plan", async (route) => {
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({ lastRun: null, snapshot: null }),
    });
  });
  await page.route("**/api/sync/marketing-actual", async (route) => {
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        configured: true,
        revision: 1,
        lastSuccessAt: null,
        rowCount: 0,
        maxDate: null,
        error: null,
      }),
    });
  });
  await page.route("**/api/updates/marketing-actual**", async (route) => {
    await route.fulfill({ contentType: "text/event-stream", body: "" });
  });
  await page.route("**/api/sync/payroll", async (route) => {
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        configured: true,
        status: "SUCCESS",
        revision: 1,
        lastSuccessAt: null,
        employeeCount: 0,
        aggregateCount: 0,
        latestPeriod: null,
        error: null,
      }),
    });
  });
  await page.route("**/api/updates/payroll**", async (route) => {
    await route.fulfill({ contentType: "text/event-stream", body: "" });
  });
  await page.route("**/api/dashboard/**", async (route) => {
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify(cashFlowFixture),
    });
  });
});

test("показывает фактический ДДС и тихо обновляет его через SSE", async ({
  page,
}) => {
  let dashboardRequests = 0;
  page.on("request", (request) => {
    if (request.url().includes("/api/dashboard/cash-flow")) {
      dashboardRequests += 1;
    }
  });

  await page.goto("/");

  await expect(
    page.getByRole("heading", {
      name: "Движение денежных средств",
      exact: true,
    }),
  ).toBeVisible();
  await expect(page.locator(".kpi-card")).toHaveCount(4);
  await expect(
    page
      .getByLabel("Ключевые показатели")
      .getByText("Рентабельность", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("img", { name: "Структура расходов" }),
  ).toBeVisible();
  await expect(
    page.getByRole("img", {
      name: "Динамика расходов по крупнейшим статьям",
    }),
  ).toBeVisible();
  await expect(
    page.getByRole("columnheader", { name: "Рентабельность" }),
  ).toBeVisible();
  await expect(
    page.getByRole("rowheader", { name: "Общее", exact: true }),
  ).toBeVisible();
  await expect.poll(() => dashboardRequests).toBeGreaterThanOrEqual(2);
});

test("хранит отдельные направления ДДС и запускает FinTablo вручную", async ({
  page,
}) => {
  await page.goto("/");

  const directionFilter = page
    .locator(".filter-button")
    .filter({ hasText: "Направления" });
  await expect(directionFilter.getByText("6", { exact: true })).toBeVisible();
  await directionFilter.click();
  await expect(
    page.locator(".directions-panel").getByText("Общее", { exact: true }),
  ).toBeVisible();

  await page.getByRole("button", { name: "Синхронизировать ДДС FinTablo" }).click();
  await expect(
    page.getByText("Фактический ДДС FinTablo обновлён.", { exact: true }),
  ).toBeVisible();

  await page.getByRole("tab", { name: "Маркетинг" }).click();
  await page
    .locator(".filter-button")
    .filter({ hasText: "Направления" })
    .click();
  await expect(page.locator(".directions-panel").getByText("Общее", { exact: true })).toHaveCount(0);
});

test("показывает русскую ошибку ручной синхронизации", async ({ page }) => {
  await page.route("**/api/sync/fintablo-cash-flow", async (route) => {
    if (route.request().method() === "POST") {
      await route.fulfill({
        status: 502,
        contentType: "application/json",
        body: JSON.stringify({
          error: "FinTablo временно недоступен. Повторите попытку позже.",
        }),
      });
      return;
    }
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify(fintabloStatus),
    });
  });
  await page.goto("/");

  await page.getByRole("button", { name: "Синхронизировать ДДС FinTablo" }).click();
  await expect(
    page.getByText(
      "FinTablo временно недоступен. Повторите попытку позже.",
      { exact: true },
    ),
  ).toBeVisible();
});
