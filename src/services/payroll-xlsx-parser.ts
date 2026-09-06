import { Prisma } from "@prisma/client";
import type ExcelJS from "exceljs";

import type { DirectionId } from "@/lib/constants";

const EXPECTED_BASE_HEADERS = ["фио", "должность", "направление"];
const EXPECTED_ACCRUAL_HEADERS: ReadonlyArray<ReadonlySet<string>> = [
  new Set(["оклад", "начислено по окладу"]),
  new Set(["отпускные"]),
  new Set(["премия"]),
  new Set(["бонус от продаж"]),
];

const MONTH_PATTERNS: Array<[RegExp, number]> = [
  [/январ/, 1],
  [/феврал/, 2],
  [/март/, 3],
  [/апрел/, 4],
  [/(?:^|\s)(?:май|мая)(?:\s|$)/, 5],
  [/июн/, 6],
  [/июл/, 7],
  [/август/, 8],
  [/сентябр/, 9],
  [/октябр/, 10],
  [/ноябр/, 11],
  [/декабр/, 12],
];

const DIRECTION_ALIASES = new Map<string, DirectionId>([
  ["брендинг", "branding"],
  ["разработка сайта", "web-development"],
  ["разработка сайтов", "web-development"],
  ["видеоконтент", "video-content"],
  ["smm", "smm"],
  ["рекламные кампании", "ad-campaigns"],
]);

export interface PayrollAggregate {
  year: number;
  month: number;
  directionId: DirectionId;
  salary: string;
  vacationPay: string;
  bonus: string;
  salesBonus: string;
}

export interface ParsedPayroll {
  aggregates: PayrollAggregate[];
  employeeCount: number;
  latestPeriod: { year: number; month: number } | null;
}

type AccrualKey = "salary" | "vacationPay" | "bonus" | "salesBonus";

const ACCRUAL_KEYS: AccrualKey[] = [
  "salary",
  "vacationPay",
  "bonus",
  "salesBonus",
];

function normalizeText(value: string) {
  return value
    .replace(/ё/g, "е")
    .replace(/[\u00a0\s]+/g, " ")
    .trim()
    .toLocaleLowerCase("ru-RU");
}

function normalizeAccrualHeader(value: string) {
  return normalizeText(value).replace(/,?\s*₽$/, "");
}

function unwrappedCellValue(value: ExcelJS.CellValue): unknown {
  if (value === null || value === undefined) return null;
  if (value instanceof Date || typeof value !== "object") return value;
  if ("result" in value && value.result !== undefined) {
    return unwrappedCellValue(value.result as ExcelJS.CellValue);
  }
  if ("richText" in value) {
    return value.richText.map((part) => part.text).join("");
  }
  if ("text" in value) return value.text;
  return value;
}

function cellText(value: ExcelJS.CellValue) {
  const unwrapped = unwrappedCellValue(value);
  return unwrapped === null || unwrapped === undefined
    ? ""
    : String(unwrapped).trim();
}

function parsePeriod(value: ExcelJS.CellValue, column: number) {
  const text = normalizeText(cellText(value));
  const yearMatch = text.match(/(?:^|\D)(20\d{2})(?:\D|$)/);
  const month = MONTH_PATTERNS.find(([pattern]) => pattern.test(text))?.[1];
  if (!yearMatch || !month) {
    throw new Error(
      `Не удалось распознать месяц и год в строке 1, столбце ${column}.`,
    );
  }
  return { year: Number.parseInt(yearMatch[1], 10), month };
}

function parseMoney(
  value: ExcelJS.CellValue,
  row: number,
  column: number,
) {
  const unwrapped = unwrappedCellValue(value);
  if (unwrapped === null || unwrapped === undefined || unwrapped === "") {
    return new Prisma.Decimal(0);
  }

  let normalized: string;
  if (typeof unwrapped === "number") {
    if (!Number.isFinite(unwrapped)) {
      throw new Error(`Некорректная сумма в строке ${row}, столбце ${column}.`);
    }
    normalized = String(unwrapped);
  } else if (typeof unwrapped === "string") {
    normalized = unwrapped
      .replace(/[\s\u00a0₽]/g, "")
      .replace(",", ".");
    if (!/^-?\d+(?:\.\d{1,2})?$/.test(normalized)) {
      throw new Error(`Некорректная сумма в строке ${row}, столбце ${column}.`);
    }
  } else {
    throw new Error(`Некорректная сумма в строке ${row}, столбце ${column}.`);
  }

  const result = new Prisma.Decimal(normalized);
  if (!result.isFinite() || result.decimalPlaces() > 2) {
    throw new Error(`Некорректная сумма в строке ${row}, столбце ${column}.`);
  }
  return result;
}

function fullNameIsUsable(value: string) {
  return value.trim().split(/\s+/).filter(Boolean).length >= 2;
}

function directionIdFromCell(value: ExcelJS.CellValue) {
  return DIRECTION_ALIASES.get(normalizeText(cellText(value))) ?? null;
}

export function normalizePayrollAggregates(aggregates: PayrollAggregate[]) {
  return [...aggregates]
    .sort(
      (left, right) =>
        left.year - right.year ||
        left.month - right.month ||
        left.directionId.localeCompare(right.directionId),
    )
    .map((row) => ({
      year: row.year,
      month: row.month,
      directionId: row.directionId,
      salary: new Prisma.Decimal(row.salary).toFixed(2),
      vacationPay: new Prisma.Decimal(row.vacationPay).toFixed(2),
      bonus: new Prisma.Decimal(row.bonus).toFixed(2),
      salesBonus: new Prisma.Decimal(row.salesBonus).toFixed(2),
    }));
}

export function parsePayrollWorksheet(
  worksheet: ExcelJS.Worksheet,
): ParsedPayroll {
  if (worksheet.columnCount < 7 || (worksheet.columnCount - 3) % 4 !== 0) {
    throw new Error("Структура столбцов XLSX не соответствует шаблону ФОТ.");
  }

  EXPECTED_BASE_HEADERS.forEach((expected, index) => {
    const column = index + 1;
    const header = normalizeText(
      cellText(worksheet.getCell(1, column).value) ||
        cellText(worksheet.getCell(2, column).value),
    );
    if (header !== expected) {
      throw new Error(
        `Ожидался заголовок «${expected}» в столбце ${column}.`,
      );
    }
  });

  const periods: Array<{ year: number; month: number; startColumn: number }> = [];
  const periodKeys = new Set<string>();
  for (let startColumn = 4; startColumn <= worksheet.columnCount; startColumn += 4) {
    const period = parsePeriod(worksheet.getCell(1, startColumn).value, startColumn);
    const periodKey = `${period.year}-${period.month}`;
    if (periodKeys.has(periodKey)) {
      throw new Error(
        `Период ${String(period.month).padStart(2, "0")}.${period.year} указан повторно.`,
      );
    }
    periodKeys.add(periodKey);

    EXPECTED_ACCRUAL_HEADERS.forEach((expected, offset) => {
      const column = startColumn + offset;
      const actual = normalizeAccrualHeader(
        cellText(worksheet.getCell(2, column).value),
      );
      if (!expected.has(actual)) {
        throw new Error(
          `Нарушена последовательность начислений в строке 2, столбце ${column}.`,
        );
      }
    });
    periods.push({ ...period, startColumn });
  }

  const totals = new Map<
    string,
    {
      year: number;
      month: number;
      directionId: DirectionId;
      values: Record<AccrualKey, Prisma.Decimal>;
    }
  >();
  let employeeCount = 0;

  for (let row = 3; row <= worksheet.rowCount; row += 1) {
    const fullName = cellText(worksheet.getCell(row, 1).value);
    if (!fullName || normalizeText(fullName) === "итого") continue;
    if (!fullNameIsUsable(fullName)) continue;

    const directionId = directionIdFromCell(worksheet.getCell(row, 3).value);
    if (!directionId) continue;
    employeeCount += 1;

    for (const period of periods) {
      const key = `${period.year}-${period.month}-${directionId}`;
      const aggregate = totals.get(key) ?? {
        year: period.year,
        month: period.month,
        directionId,
        values: {
          salary: new Prisma.Decimal(0),
          vacationPay: new Prisma.Decimal(0),
          bonus: new Prisma.Decimal(0),
          salesBonus: new Prisma.Decimal(0),
        },
      };
      ACCRUAL_KEYS.forEach((accrualKey, offset) => {
        aggregate.values[accrualKey] = aggregate.values[accrualKey].plus(
          parseMoney(
            worksheet.getCell(row, period.startColumn + offset).value,
            row,
            period.startColumn + offset,
          ),
        );
      });
      totals.set(key, aggregate);
    }
  }

  const aggregates = normalizePayrollAggregates(
    [...totals.values()].map((aggregate) => ({
      year: aggregate.year,
      month: aggregate.month,
      directionId: aggregate.directionId,
      salary: aggregate.values.salary.toFixed(2),
      vacationPay: aggregate.values.vacationPay.toFixed(2),
      bonus: aggregate.values.bonus.toFixed(2),
      salesBonus: aggregate.values.salesBonus.toFixed(2),
    })),
  );
  const latestPeriod = periods
    .map(({ year, month }) => ({ year, month }))
    .sort((left, right) => left.year - right.year || left.month - right.month)
    .at(-1) ?? null;

  return { aggregates, employeeCount, latestPeriod };
}
