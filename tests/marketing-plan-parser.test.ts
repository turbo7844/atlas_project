import { describe, expect, it } from "vitest";

import { DIRECTIONS, MONTHS } from "@/lib/constants";
import {
  parseLocalizedNumber,
  parseMarketingPlanCsv,
} from "@/services/marketing-plan-parser";

const header =
  '№ мес.,Месяц,Направление,Посещения,Лиды,"Рекламный бюджет, ₽",Конверсия Лид/Посещение,"CPC, ₽","CPL, ₽"';

function fixture() {
  const rows = [header];
  for (let month = 1; month <= 12; month += 1) {
    for (const [index, direction] of DIRECTIONS.entries()) {
      const visits = 1_000 + month * 10 + index * 100;
      const leads = 25 + index;
      const cpc = 100 + index * 5;
      const budget = visits * cpc;
      const conversion = ((leads / visits) * 100).toFixed(2).replace(".", ",");
      const cpl = (budget / leads).toFixed(2).replace(".", ",");
      rows.push(
        [
          month,
          MONTHS[month - 1],
          direction.name,
          visits,
          leads,
          `"${budget.toFixed(2).replace(".", ",")}"`,
          `"${conversion}%"`,
          `"${cpc.toFixed(2).replace(".", ",")}"`,
          `"${cpl}"`,
        ].join(","),
      );
    }
  }
  rows.push(',ИТОГО за 2026 год,все направления,0,0,"0,00","0,00%","0,00","0,00"');
  return rows.join("\n");
}

describe("parseLocalizedNumber", () => {
  it("разбирает русские пробелы, запятые, валюту и проценты", () => {
    expect(parseLocalizedNumber(" 73 803,60 ₽")).toBe(73_803.6);
    expect(parseLocalizedNumber("2,56%")).toBe(2.56);
    expect(parseLocalizedNumber("1\u202f280")).toBe(1_280);
  });

  it("отклоняет пустое или нечисловое значение", () => {
    expect(() => parseLocalizedNumber("")).toThrow("не удалось разобрать");
    expect(() => parseLocalizedNumber("нет")).toThrow("не удалось разобрать");
  });
});

describe("parseMarketingPlanCsv", () => {
  it("принимает 60 строк и игнорирует итог", () => {
    const rows = parseMarketingPlanCsv(fixture(), 2026);
    expect(rows).toHaveLength(60);
    expect(rows[0]).toMatchObject({
      year: 2026,
      month: 1,
      directionId: "branding",
      visits: 1010,
      leads: 25,
    });
    expect(rows.at(-1)).toMatchObject({
      month: 12,
      directionId: "ad-campaigns",
    });
  });

  it("отклоняет неполный набор направлений", () => {
    const incomplete = fixture().split("\n").slice(0, -2).join("\n");
    expect(() => parseMarketingPlanCsv(incomplete, 2026)).toThrow(
      "Ожидалось 60 строк",
    );
  });

  it("отклоняет некорректную формулу CPC", () => {
    const invalid = fixture().replace('"100,00","4040,00"', '"101,00","4040,00"');
    expect(() => parseMarketingPlanCsv(invalid, 2026)).toThrow(
      "CPC не совпадает",
    );
  });
});
