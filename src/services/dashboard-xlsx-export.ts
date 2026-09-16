import ExcelJS from "exceljs";

import {
  CASH_FLOW_DIRECTIONS,
  MONTHS,
  type DashboardSection,
} from "@/lib/constants";
import type {
  CashFlowRow,
  DashboardResponse,
  MarketingRow,
  RevenueRow,
  SalesRow,
} from "@/types/dashboard";

type ExportCell = string | number | Date | null;

type ExportColumn = {
  header: string;
  width: number;
  numFmt?: string;
};

type ExportDefinition = {
  sheetName: string;
  title: string;
  columns: ExportColumn[];
  rows: ExportCell[][];
};

const amountFormat = '#,##0" ₽";-#,##0" ₽";"—"';
const integerFormat = '#,##0;-#,##0;"—"';
const percentFormat = '0.0%;-0.0%;"—"';
const directionNames = new Map(
  CASH_FLOW_DIRECTIONS.map((direction) => [direction.id, direction.name]),
);

const sectionSlugs: Record<Exclude<DashboardSection, "dashboards">, string> = {
  marketing: "marketing",
  revenue: "revenue-payroll",
  "cash-flow": "cash-flow",
  sales: "sales",
};

const granularityLabels = {
  month: "Месяцы",
  quarter: "Кварталы",
  year: "Год",
} as const;

function marketingDefinition(data: DashboardResponse): ExportDefinition {
  return {
    sheetName: "Маркетинг",
    title: "Маркетинг по направлениям",
    columns: [
      { header: "Направление", width: 28 },
      { header: "Бюджет — план", width: 18, numFmt: amountFormat },
      { header: "Бюджет — факт", width: 18, numFmt: amountFormat },
      { header: "Посещения — план", width: 18, numFmt: integerFormat },
      { header: "Посещения — факт", width: 18, numFmt: integerFormat },
      { header: "Лиды — план", width: 15, numFmt: integerFormat },
      { header: "Лиды — факт", width: 15, numFmt: integerFormat },
      { header: "Конверсия — план", width: 19, numFmt: percentFormat },
      { header: "Конверсия — факт", width: 19, numFmt: percentFormat },
      { header: "CPC — план", width: 15, numFmt: amountFormat },
      { header: "CPC — факт", width: 15, numFmt: amountFormat },
      { header: "CPL — план", width: 15, numFmt: amountFormat },
      { header: "CPL — факт", width: 15, numFmt: amountFormat },
    ],
    rows: (data.rows as MarketingRow[]).map((row) => [
      row.direction,
      row.planBudget,
      row.actualBudget,
      row.planVisits,
      row.actualVisits,
      row.planLeads,
      row.actualLeads,
      row.planConversion,
      row.actualConversion,
      row.planCpc,
      row.actualCpc,
      row.planCpl,
      row.actualCpl,
    ]),
  };
}

function revenueDefinition(data: DashboardResponse): ExportDefinition {
  return {
    sheetName: "Выручка и ФОТ",
    title: "Экономика направлений",
    columns: [
      { header: "Направление", width: 28 },
      { header: "Выручка", width: 18, numFmt: amountFormat },
      { header: "Подрядчики", width: 18, numFmt: amountFormat },
      { header: "ФОТ", width: 18, numFmt: amountFormat },
      { header: "Оклад", width: 18, numFmt: amountFormat },
      { header: "Отпускные", width: 18, numFmt: amountFormat },
      { header: "Премия", width: 18, numFmt: amountFormat },
      { header: "Бонус от продаж", width: 20, numFmt: amountFormat },
      { header: "Маржа до ФОТ", width: 18, numFmt: amountFormat },
      { header: "Доля подрядчиков", width: 20, numFmt: percentFormat },
    ],
    rows: (data.rows as RevenueRow[]).map((row) => [
      row.direction,
      row.revenue,
      row.contractorCost,
      row.payroll,
      row.payrollSalary,
      row.payrollVacationPay,
      row.payrollBonus,
      row.payrollSalesBonus,
      row.margin,
      row.contractorShare,
    ]),
  };
}

function cashFlowDefinition(data: DashboardResponse): ExportDefinition {
  return {
    sheetName: "ДДС",
    title: "Движение средств по направлениям",
    columns: [
      { header: "Направление", width: 28 },
      { header: "Приход", width: 18, numFmt: amountFormat },
      { header: "Расход", width: 18, numFmt: amountFormat },
      { header: "Чистый поток", width: 18, numFmt: amountFormat },
      { header: "Рентабельность", width: 18, numFmt: percentFormat },
    ],
    rows: (data.rows as CashFlowRow[]).map((row) => [
      row.direction,
      row.income,
      row.expense,
      row.net,
      row.profitability,
    ]),
  };
}

function salesDefinition(data: DashboardResponse): ExportDefinition {
  return {
    sheetName: "Продажи",
    title: "Продажи по направлениям",
    columns: [
      { header: "Направление", width: 28 },
      { header: "Лиды", width: 14, numFmt: integerFormat },
      { header: "Встречи", width: 14, numFmt: integerFormat },
      { header: "КП", width: 14, numFmt: integerFormat },
      { header: "Договоры", width: 14, numFmt: integerFormat },
      { header: "Оплаты", width: 14, numFmt: integerFormat },
      { header: "Выручка", width: 18, numFmt: amountFormat },
    ],
    rows: (data.rows as SalesRow[]).map((row) => [
      row.direction,
      row.leads,
      row.meetings,
      row.proposals,
      row.contracts,
      row.payments,
      row.revenue,
    ]),
  };
}

function exportDefinition(
  section: Exclude<DashboardSection, "dashboards">,
  data: DashboardResponse,
) {
  switch (section) {
    case "marketing":
      return marketingDefinition(data);
    case "revenue":
      return revenueDefinition(data);
    case "cash-flow":
      return cashFlowDefinition(data);
    case "sales":
      return salesDefinition(data);
  }
}

function formatMonth(value: string) {
  const [year, month] = value.split("-");
  const monthIndex = Number(month) - 1;
  return `${MONTHS[monthIndex] ?? month} ${year}`;
}

function lastColumnName(columnCount: number) {
  let dividend = columnCount;
  let name = "";
  while (dividend > 0) {
    const modulo = (dividend - 1) % 26;
    name = String.fromCharCode(65 + modulo) + name;
    dividend = Math.floor((dividend - modulo) / 26);
  }
  return name;
}

export function dashboardExportFilename(
  section: Exclude<DashboardSection, "dashboards">,
  from: string,
  to: string,
) {
  return `atlas-${sectionSlugs[section]}-${from}_${to}.xlsx`;
}

export function buildDashboardWorkbook(
  section: Exclude<DashboardSection, "dashboards">,
  data: DashboardResponse,
  generatedAt = new Date(),
) {
  const definition = exportDefinition(section, data);
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "Atlas";
  workbook.company = "Atlas";
  workbook.created = generatedAt;
  workbook.modified = generatedAt;

  const worksheet = workbook.addWorksheet(definition.sheetName, {
    views: [
      {
        state: "frozen",
        ySplit: 7,
        topLeftCell: "A8",
        showGridLines: false,
      },
    ],
    pageSetup: {
      paperSize: 9,
      orientation: "landscape",
      fitToPage: true,
      fitToWidth: 1,
      fitToHeight: 0,
      printTitlesRow: "7:7",
      margins: {
        left: 0.25,
        right: 0.25,
        top: 0.5,
        bottom: 0.5,
        header: 0.2,
        footer: 0.2,
      },
    },
  });
  const lastColumn = lastColumnName(definition.columns.length);

  worksheet.mergeCells(`A1:${lastColumn}1`);
  worksheet.getCell("A1").value = definition.title;
  worksheet.getCell("A1").font = {
    name: "Montserrat",
    size: 18,
    bold: true,
    color: { argb: "FF17324D" },
  };
  worksheet.getCell("A1").alignment = { vertical: "middle" };
  worksheet.getRow(1).height = 30;

  const selectedDirections = data.meta.directions
    .map((direction) => directionNames.get(direction) ?? direction)
    .join(", ");
  const metadata: Array<[string, ExportCell]> = [
    [
      "Период",
      `${formatMonth(data.meta.from)} — ${formatMonth(data.meta.to)}`,
    ],
    ["Группировка", granularityLabels[data.meta.granularity]],
    ["Направления", selectedDirections || "Не выбраны"],
    ["Сформировано", generatedAt],
  ];
  metadata.forEach(([label, value], index) => {
    const row = worksheet.getRow(index + 2);
    row.getCell(1).value = label;
    row.getCell(1).font = {
      name: "Montserrat",
      size: 9,
      bold: true,
      color: { argb: "FF5C6B7A" },
    };
    row.getCell(2).value = value;
    row.getCell(2).font = {
      name: "Montserrat",
      size: 9,
      color: { argb: "FF17324D" },
    };
  });
  worksheet.getCell("B5").numFmt = "dd.mm.yyyy hh:mm";

  const headerRow = worksheet.getRow(7);
  definition.columns.forEach((column, index) => {
    const cell = headerRow.getCell(index + 1);
    cell.value = column.header;
    cell.font = {
      name: "Montserrat",
      size: 9,
      bold: true,
      color: { argb: "FFFFFFFF" },
    };
    cell.fill = {
      type: "pattern",
      pattern: "solid",
      fgColor: { argb: "FF1F5B8F" },
    };
    cell.alignment = {
      vertical: "middle",
      horizontal: index === 0 ? "left" : "right",
      wrapText: true,
    };
  });
  headerRow.height = 32;

  definition.columns.forEach((column, index) => {
    const worksheetColumn = worksheet.getColumn(index + 1);
    worksheetColumn.width = column.width;
    if (column.numFmt) worksheetColumn.numFmt = column.numFmt;
  });

  definition.rows.forEach((values, rowIndex) => {
    const row = worksheet.getRow(rowIndex + 8);
    values.forEach((value, columnIndex) => {
      const cell = row.getCell(columnIndex + 1);
      cell.value = value;
      cell.font = {
        name: "Montserrat",
        size: 9,
        color: { argb: "FF17324D" },
      };
      cell.alignment = {
        vertical: "middle",
        horizontal: columnIndex === 0 ? "left" : "right",
      };
      cell.border = {
        bottom: { style: "thin", color: { argb: "FFD7DEE5" } },
      };
      if (rowIndex % 2 === 1) {
        cell.fill = {
          type: "pattern",
          pattern: "solid",
          fgColor: { argb: "FFF3F7FA" },
        };
      }
    });
    row.height = 22;
  });

  worksheet.autoFilter = `A7:${lastColumn}7`;
  worksheet.headerFooter.oddFooter =
    "&LAtlas&CСтраница &P из &N&RСформировано &D";

  return workbook;
}
