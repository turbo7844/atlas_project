import { parse } from "csv-parse/sync";

import {
  DIRECTION_BY_SOURCE_NAME,
  DIRECTIONS,
  MONTHS,
  type DirectionId,
} from "@/lib/constants";

const REQUIRED_HEADERS = [
  "№ мес.",
  "Месяц",
  "Направление",
  "Посещения",
  "Лиды",
  "Рекламный бюджет, ₽",
  "Конверсия Лид/Посещение",
  "CPC, ₽",
  "CPL, ₽",
] as const;

type CsvRecord = Record<(typeof REQUIRED_HEADERS)[number], string>;

export interface ParsedMarketingPlanRow {
  year: number;
  month: number;
  directionId: DirectionId;
  visits: number;
  leads: number;
  budget: number;
  conversion: number;
  cpc: number;
  cpl: number;
}

export function parseLocalizedNumber(
  value: string,
  fieldName = "Значение",
): number {
  const normalized = String(value ?? "")
    .replace(/[\s\u00a0\u202f₽%]/g, "")
    .replace(",", ".")
    .trim();
  const parsed = Number(normalized);

  if (!normalized || !Number.isFinite(parsed)) {
    throw new Error(`${fieldName}: не удалось разобрать «${value}».`);
  }

  return parsed;
}

function expectClose(
  actual: number,
  expected: number,
  tolerance: number,
  message: string,
) {
  if (Math.abs(actual - expected) > tolerance) {
    throw new Error(message);
  }
}

export function parseMarketingPlanCsv(
  raw: string,
  year: number,
): ParsedMarketingPlanRow[] {
  const header = raw.split(/\r?\n/, 1)[0]?.replace(/^\uFEFF/, "") ?? "";
  for (const required of REQUIRED_HEADERS) {
    if (!header.includes(required)) {
      throw new Error(`В Google-таблице отсутствует столбец «${required}».`);
    }
  }

  const records = parse(raw, {
    bom: true,
    columns: (headers: string[]) =>
      headers.map((item) => item.replace(/^\uFEFF/, "").trim()),
    skip_empty_lines: true,
    relax_column_count: false,
    trim: false,
  }) as CsvRecord[];

  const rows: ParsedMarketingPlanRow[] = [];

  for (const [index, record] of records.entries()) {
    const rowNumber = index + 2;
    const monthNumberRaw = String(record["№ мес."] ?? "").trim();
    const directionName = String(record["Направление"] ?? "").trim();

    if (!monthNumberRaw || directionName.toLowerCase() === "все направления") {
      continue;
    }

    const month = parseLocalizedNumber(monthNumberRaw, `Строка ${rowNumber}, месяц`);
    if (!Number.isInteger(month) || month < 1 || month > 12) {
      throw new Error(`Строка ${rowNumber}: номер месяца должен быть от 1 до 12.`);
    }

    const monthName = String(record.Месяц ?? "").trim();
    if (monthName !== MONTHS[month - 1]) {
      throw new Error(
        `Строка ${rowNumber}: номер месяца не совпадает с названием «${monthName}».`,
      );
    }

    const directionId = DIRECTION_BY_SOURCE_NAME.get(directionName) as
      | DirectionId
      | undefined;
    if (!directionId) {
      throw new Error(
        `Строка ${rowNumber}: неизвестное направление «${directionName}».`,
      );
    }

    const visits = parseLocalizedNumber(
      record.Посещения,
      `Строка ${rowNumber}, посещения`,
    );
    const leads = parseLocalizedNumber(
      record.Лиды,
      `Строка ${rowNumber}, лиды`,
    );
    const budget = parseLocalizedNumber(
      record["Рекламный бюджет, ₽"],
      `Строка ${rowNumber}, бюджет`,
    );
    const conversion =
      parseLocalizedNumber(
        record["Конверсия Лид/Посещение"],
        `Строка ${rowNumber}, конверсия`,
      ) / 100;
    const cpc = parseLocalizedNumber(
      record["CPC, ₽"],
      `Строка ${rowNumber}, CPC`,
    );
    const cpl = parseLocalizedNumber(
      record["CPL, ₽"],
      `Строка ${rowNumber}, CPL`,
    );

    if (
      !Number.isInteger(visits) ||
      !Number.isInteger(leads) ||
      visits <= 0 ||
      leads <= 0 ||
      leads > visits ||
      budget <= 0
    ) {
      throw new Error(`Строка ${rowNumber}: значения посещений, лидов или бюджета некорректны.`);
    }

    expectClose(
      conversion,
      leads / visits,
      0.000_06,
      `Строка ${rowNumber}: конверсия не совпадает с отношением лидов к посещениям.`,
    );
    expectClose(
      cpc,
      budget / visits,
      0.02,
      `Строка ${rowNumber}: CPC не совпадает с отношением бюджета к посещениям.`,
    );
    expectClose(
      cpl,
      budget / leads,
      0.02,
      `Строка ${rowNumber}: CPL не совпадает с отношением бюджета к лидам.`,
    );

    rows.push({
      year,
      month,
      directionId,
      visits,
      leads,
      budget,
      conversion,
      cpc,
      cpl,
    });
  }

  const expectedCount = 12 * DIRECTIONS.length;
  if (rows.length !== expectedCount) {
    throw new Error(
      `Ожидалось ${expectedCount} строк плана, получено ${rows.length}.`,
    );
  }

  const uniqueKeys = new Set(
    rows.map((row) => `${row.month}:${row.directionId}`),
  );
  if (uniqueKeys.size !== expectedCount) {
    throw new Error("В плане есть повторяющиеся или отсутствующие сочетания месяца и направления.");
  }

  return rows.sort(
    (left, right) =>
      left.month - right.month ||
      DIRECTIONS.findIndex((item) => item.id === left.directionId) -
        DIRECTIONS.findIndex((item) => item.id === right.directionId),
  );
}

export function normalizePlanRows(rows: ParsedMarketingPlanRow[]) {
  return rows.map((row) => ({
    ...row,
    budget: row.budget.toFixed(2),
    conversion: row.conversion.toFixed(6),
    cpc: row.cpc.toFixed(2),
    cpl: row.cpl.toFixed(2),
  }));
}
