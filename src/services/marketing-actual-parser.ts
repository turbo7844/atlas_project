import { createHash } from "node:crypto";

import {
  DIRECTION_BY_SOURCE_NAME,
  DIRECTIONS,
  type DirectionId,
} from "@/lib/constants";
import { calculateMarketingMetrics } from "@/services/marketing-metrics";

export const MARKETING_ACTUAL_HEADERS = [
  "Дата",
  "Направление",
  "Посещения",
  "Лиды",
  "Рекламный бюджет, ₽",
  "Конверсия Лид/Посещение",
  "CPC, ₽",
  "CPL, ₽",
] as const;

export const MAX_MARKETING_ACTUAL_ROWS = 10_000;
export const MAX_MARKETING_ACTUAL_CHUNK_ROWS = 500;

export interface MarketingActualInputRow {
  sourceRow: unknown;
  date: unknown;
  direction: unknown;
  visits: unknown;
  leads: unknown;
  budget: unknown;
  conversion: unknown;
  cpc: unknown;
  cpl: unknown;
  sourceUpdatedAt?: unknown;
}

export interface ParsedMarketingActualRow {
  sourceRow: number;
  date: string;
  dateValue: Date;
  directionId: DirectionId;
  direction: string;
  visits: number;
  leads: number;
  budget: number;
  conversion: number | null;
  cpc: number | null;
  cpl: number | null;
  sourceUpdatedAt: Date | null;
}

function fieldError(rowNumber: number, message: string) {
  return new Error(`Строка ${rowNumber}: ${message}`);
}

export function parseActualLocalizedNumber(
  value: unknown,
  fieldName: string,
  rowNumber: number,
) {
  if (typeof value === "number") {
    if (Number.isFinite(value)) return value;
    throw fieldError(rowNumber, `${fieldName} содержит некорректное число.`);
  }

  const normalized = String(value ?? "")
    .replace(/[\s\u00a0\u202f₽%]/g, "")
    .replace(",", ".")
    .trim();
  const parsed = Number(normalized);
  if (!normalized || !Number.isFinite(parsed)) {
    throw fieldError(rowNumber, `${fieldName} содержит некорректное число.`);
  }
  return parsed;
}

function optionalMetric(
  value: unknown,
  fieldName: string,
  rowNumber: number,
  percent = false,
) {
  if (value === null || value === undefined || String(value).trim() === "") {
    return null;
  }
  const parsed = parseActualLocalizedNumber(value, fieldName, rowNumber);
  return percent && typeof value === "string" && value.includes("%")
    ? parsed / 100
    : parsed;
}

export function parseMarketingActualDate(value: unknown, rowNumber: number) {
  const date = String(value ?? "").trim();
  if (!/^2026-(0[1-9]|1[0-2])-([0-2]\d|3[01])$/.test(date)) {
    throw fieldError(rowNumber, "дата должна относиться к 2026 году и иметь формат YYYY-MM-DD.");
  }
  const parsed = new Date(`${date}T00:00:00.000Z`);
  if (
    Number.isNaN(parsed.getTime()) ||
    parsed.toISOString().slice(0, 10) !== date
  ) {
    throw fieldError(rowNumber, "указана несуществующая дата.");
  }
  return { date, parsed };
}

function expectMetric(
  actual: number | null,
  expected: number | null,
  tolerance: number,
  rowNumber: number,
  metric: string,
) {
  if (expected === null) {
    if (actual !== null && actual !== 0) {
      throw fieldError(rowNumber, `${metric} должен быть пустым или равным нулю.`);
    }
    return;
  }
  if (actual === null || Math.abs(actual - expected) > tolerance) {
    throw fieldError(rowNumber, `${metric} не совпадает с расчётным значением.`);
  }
}

export function parseMarketingActualRow(
  input: MarketingActualInputRow,
): ParsedMarketingActualRow {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new Error("Строка маркетингового факта имеет неверный формат.");
  }

  const sourceRow = parseActualLocalizedNumber(
    input.sourceRow,
    "номер исходной строки",
    0,
  );
  if (
    !Number.isInteger(sourceRow) ||
    sourceRow < 2 ||
    sourceRow > MAX_MARKETING_ACTUAL_ROWS + 1
  ) {
    throw new Error("Номер исходной строки должен быть целым числом от 2 до 10001.");
  }

  const { date, parsed: dateValue } = parseMarketingActualDate(
    input.date,
    sourceRow,
  );
  const direction = String(input.direction ?? "").trim();
  const directionId = DIRECTION_BY_SOURCE_NAME.get(direction) as
    | DirectionId
    | undefined;
  if (!directionId) {
    throw fieldError(sourceRow, `неизвестное направление «${direction}».`);
  }

  const visits = parseActualLocalizedNumber(
    input.visits,
    "посещения",
    sourceRow,
  );
  const leads = parseActualLocalizedNumber(input.leads, "лиды", sourceRow);
  const budget = parseActualLocalizedNumber(
    input.budget,
    "рекламный бюджет",
    sourceRow,
  );
  if (
    !Number.isInteger(visits) ||
    !Number.isInteger(leads) ||
    visits < 0 ||
    leads < 0 ||
    leads > visits ||
    budget < 0
  ) {
    throw fieldError(
      sourceRow,
      "посещения и лиды должны быть целыми неотрицательными числами, бюджет — неотрицательным, а лиды не могут превышать посещения.",
    );
  }

  const roundedBudget = Number(budget.toFixed(2));
  const conversion = optionalMetric(
    input.conversion,
    "конверсия",
    sourceRow,
    true,
  );
  const cpc = optionalMetric(input.cpc, "CPC", sourceRow);
  const cpl = optionalMetric(input.cpl, "CPL", sourceRow);
  const calculated = calculateMarketingMetrics([
    { visits, leads, budget: roundedBudget },
  ]);
  expectMetric(conversion, calculated.conversion, 0.000_06, sourceRow, "Конверсия");
  expectMetric(cpc, calculated.cpc, 0.02, sourceRow, "CPC");
  expectMetric(cpl, calculated.cpl, 0.02, sourceRow, "CPL");

  let sourceUpdatedAt: Date | null = null;
  if (input.sourceUpdatedAt !== undefined && input.sourceUpdatedAt !== null) {
    sourceUpdatedAt = new Date(String(input.sourceUpdatedAt));
    if (Number.isNaN(sourceUpdatedAt.getTime())) {
      throw fieldError(sourceRow, "время изменения задано неверно.");
    }
  }

  return {
    sourceRow,
    date,
    dateValue,
    directionId,
    direction,
    visits,
    leads,
    budget: roundedBudget,
    conversion: calculated.conversion,
    cpc: calculated.cpc,
    cpl: calculated.cpl,
    sourceUpdatedAt,
  };
}

export function validateMarketingActualHeaders(value: unknown) {
  if (
    !Array.isArray(value) ||
    value.length !== MARKETING_ACTUAL_HEADERS.length ||
    value.some((header, index) => header !== MARKETING_ACTUAL_HEADERS[index])
  ) {
    throw new Error(
      "Заголовки таблицы маркетингового факта не соответствуют ожидаемому формату.",
    );
  }
  return [...MARKETING_ACTUAL_HEADERS];
}

export function validateMarketingActualRows(value: unknown) {
  if (!Array.isArray(value)) {
    throw new Error("Список строк маркетингового факта задан неверно.");
  }
  if (value.length > MAX_MARKETING_ACTUAL_ROWS) {
    throw new Error("Маркетинговый факт не может содержать более 10 000 строк.");
  }

  const rows = value.map((row) =>
    parseMarketingActualRow(row as MarketingActualInputRow),
  );
  const sourceRows = new Set<number>();
  const dateDirections = new Set<string>();
  for (const row of rows) {
    const dateDirection = `${row.date}:${row.directionId}`;
    if (sourceRows.has(row.sourceRow)) {
      throw new Error(`Исходная строка ${row.sourceRow} передана повторно.`);
    }
    if (dateDirections.has(dateDirection)) {
      throw new Error(
        `Сочетание даты ${row.date} и направления «${row.direction}» передано повторно.`,
      );
    }
    sourceRows.add(row.sourceRow);
    dateDirections.add(dateDirection);
  }
  return rows.sort((left, right) => left.sourceRow - right.sourceRow);
}

export function canonicalMarketingActualRows(
  rows: ParsedMarketingActualRow[],
) {
  return [...rows]
    .sort((left, right) => left.sourceRow - right.sourceRow)
    .map((row) => ({
      sourceRow: row.sourceRow,
      date: row.date,
      direction: row.direction,
      visits: row.visits,
      leads: row.leads,
      budget: row.budget.toFixed(2),
      conversion: row.conversion?.toFixed(6) ?? "",
      cpc: row.cpc?.toFixed(2) ?? "",
      cpl: row.cpl?.toFixed(2) ?? "",
    }));
}

export function hashMarketingActualRows(rows: ParsedMarketingActualRow[]) {
  return createHash("sha256")
    .update(JSON.stringify(canonicalMarketingActualRows(rows)))
    .digest("hex");
}

export function directionName(directionId: string) {
  return DIRECTIONS.find((direction) => direction.id === directionId)?.name;
}
