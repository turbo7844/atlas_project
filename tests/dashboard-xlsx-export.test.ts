import ExcelJS from "exceljs";
import { describe, expect, it } from "vitest";

import {
  buildDashboardWorkbook,
  dashboardExportFilename,
} from "@/services/dashboard-xlsx-export";
import type { DashboardResponse } from "@/types/dashboard";

const marketingDashboard: DashboardResponse = {
  meta: {
    section: "marketing",
    from: "2026-01",
    to: "2026-03",
    granularity: "month",
    directions: ["branding"],
    actualThrough: "2026-03",
    planThrough: "2026-12",
  },
  kpis: [],
  series: [],
  rows: [
    {
      directionId: "branding",
      direction: "Брендинг",
      planBudget: 1_000_000,
      actualBudget: 950_000,
      planVisits: 5_000,
      actualVisits: 4_800,
      planLeads: 120,
      actualLeads: 115,
      planConversion: 0.024,
      actualConversion: 0.0239,
      planCpc: 200,
      actualCpc: 197.92,
      planCpl: 8_333.33,
      actualCpl: 8_260.87,
    },
  ],
};

describe("экспорт таблицы дашборда в Excel", () => {
  it("создаёт настоящий XLSX с числовыми ячейками и текущими фильтрами", async () => {
    const workbook = buildDashboardWorkbook(
      "marketing",
      marketingDashboard,
      new Date("2026-09-16T09:30:00.000Z"),
    );
    const buffer = await workbook.xlsx.writeBuffer();
    const restored = new ExcelJS.Workbook();
    await restored.xlsx.load(buffer);

    const worksheet = restored.getWorksheet("Маркетинг");
    expect(worksheet?.getCell("A1").value).toBe(
      "Маркетинг по направлениям",
    );
    expect(worksheet?.getCell("B2").value).toBe(
      "Январь 2026 — Март 2026",
    );
    expect(worksheet?.getCell("B4").value).toBe("Брендинг");
    expect(worksheet?.getCell("B7").value).toBe("Бюджет — план");
    expect(worksheet?.getCell("A8").value).toBe("Брендинг");
    expect(worksheet?.getCell("B8").value).toBe(1_000_000);
    expect(worksheet?.getCell("H8").value).toBe(0.024);
    expect(worksheet?.getCell("H8").numFmt).toBe('0.0%;-0.0%;"—"');
    expect(worksheet?.autoFilter).toBe("A7:M7");
  });

  it("выносит состав ФОТ в отдельные столбцы", () => {
    const revenueDashboard: DashboardResponse = {
      ...marketingDashboard,
      meta: { ...marketingDashboard.meta, section: "revenue" },
      rows: [
        {
          directionId: "branding",
          direction: "Брендинг",
          revenue: 3_000_000,
          contractorCost: 900_000,
          payroll: 450_000,
          payrollSalary: 350_000,
          payrollVacationPay: 20_000,
          payrollBonus: 70_000,
          payrollSalesBonus: 10_000,
          margin: 2_100_000,
          contractorShare: 0.3,
          overLimit: false,
        },
      ],
    };

    const worksheet = buildDashboardWorkbook(
      "revenue",
      revenueDashboard,
    ).getWorksheet("Выручка и ФОТ");

    expect(worksheet?.getCell("E7").value).toBe("Оклад");
    expect(worksheet?.getCell("H7").value).toBe("Бонус от продаж");
    expect(worksheet?.getCell("E8").value).toBe(350_000);
    expect(worksheet?.getCell("H8").value).toBe(10_000);
  });

  it("формирует предсказуемое имя файла", () => {
    expect(
      dashboardExportFilename("cash-flow", "2026-04", "2026-06"),
    ).toBe("atlas-cash-flow-2026-04_2026-06.xlsx");
  });
});
