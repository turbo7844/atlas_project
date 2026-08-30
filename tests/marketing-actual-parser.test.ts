import { describe, expect, it } from "vitest";

import {
  canonicalMarketingActualRows,
  hashMarketingActualRows,
  MARKETING_ACTUAL_HEADERS,
  parseActualLocalizedNumber,
  parseMarketingActualRow,
  validateMarketingActualHeaders,
  validateMarketingActualRows,
} from "@/services/marketing-actual-parser";

function row(overrides: Record<string, unknown> = {}) {
  return {
    sourceRow: 2,
    date: "2026-08-29",
    direction: "Брендинг",
    visits: "1 000",
    leads: "25",
    budget: "100 000,00 ₽",
    conversion: "2,5%",
    cpc: "100,00 ₽",
    cpl: "4 000,00 ₽",
    ...overrides,
  };
}

describe("парсер дневного маркетингового факта", () => {
  it("разбирает русские числа, дату и формулы", () => {
    const parsed = parseMarketingActualRow(row());

    expect(parsed).toMatchObject({
      sourceRow: 2,
      date: "2026-08-29",
      directionId: "branding",
      visits: 1_000,
      leads: 25,
      budget: 100_000,
      conversion: 0.025,
      cpc: 100,
      cpl: 4_000,
    });
    expect(parseActualLocalizedNumber("1\u202f234,50 ₽", "Бюджет", 2)).toBe(
      1_234.5,
    );
  });

  it("разрешает нули и пустые производные метрики", () => {
    expect(
      parseMarketingActualRow(
        row({
          visits: 0,
          leads: 0,
          budget: 0,
          conversion: "",
          cpc: 0,
          cpl: null,
        }),
      ),
    ).toMatchObject({
      visits: 0,
      leads: 0,
      budget: 0,
      conversion: null,
      cpc: null,
      cpl: null,
    });
  });

  it("отклоняет несуществующую дату и дробные посещения", () => {
    expect(() => parseMarketingActualRow(row({ date: "2026-02-30" }))).toThrow(
      "несуществующая дата",
    );
    expect(() => parseMarketingActualRow(row({ visits: "1000,5" }))).toThrow(
      "целыми неотрицательными",
    );
  });

  it("отклоняет отрицательные значения, лиды выше посещений и неверную формулу", () => {
    expect(() => parseMarketingActualRow(row({ budget: -1 }))).toThrow(
      "неотрицательным",
    );
    expect(() =>
      parseMarketingActualRow(row({ visits: 10, leads: 11 })),
    ).toThrow("не могут превышать");
    expect(() => parseMarketingActualRow(row({ cpc: 101 }))).toThrow(
      "CPC не совпадает",
    );
  });

  it("отклоняет дубликаты даты с направлением и исходной строки", () => {
    expect(() =>
      validateMarketingActualRows([row(), row({ sourceRow: 3 })]),
    ).toThrow("передано повторно");
    expect(() =>
      validateMarketingActualRows([
        row(),
        row({
          direction: "SMM",
          visits: 100,
          leads: 10,
          budget: 1_000,
          conversion: 0.1,
          cpc: 10,
          cpl: 100,
        }),
      ]),
    ).toThrow("Исходная строка 2");
  });

  it("строго проверяет заголовки и создаёт стабильный SHA-256", () => {
    expect(validateMarketingActualHeaders([...MARKETING_ACTUAL_HEADERS])).toEqual(
      MARKETING_ACTUAL_HEADERS,
    );
    expect(() =>
      validateMarketingActualHeaders(
        MARKETING_ACTUAL_HEADERS.filter((header) => header !== "CPL, ₽"),
      ),
    ).toThrow("Заголовки");

    const first = parseMarketingActualRow(row());
    const second = parseMarketingActualRow(
      row({
        sourceRow: 3,
        date: "2026-08-30",
        direction: "SMM",
        visits: 100,
        leads: 10,
        budget: 1_000,
        conversion: 0.1,
        cpc: 10,
        cpl: 100,
      }),
    );
    expect(hashMarketingActualRows([second, first])).toBe(
      hashMarketingActualRows([first, second]),
    );
    expect(canonicalMarketingActualRows([first])[0]).toMatchObject({
      budget: "100000.00",
      conversion: "0.025000",
      cpc: "100.00",
      cpl: "4000.00",
    });
  });
});
