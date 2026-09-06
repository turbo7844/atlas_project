import ExcelJS from "exceljs";
import { describe, expect, it } from "vitest";

import { parsePayrollWorksheet } from "@/services/payroll-xlsx-parser";

function worksheetWithPeriods(periods: string[]) {
  const workbook = new ExcelJS.Workbook();
  const worksheet = workbook.addWorksheet("Начисления");
  worksheet.getCell(2, 1).value = "ФИО";
  worksheet.getCell(2, 2).value = "Должность";
  worksheet.getCell(2, 3).value = "Направление";
  periods.forEach((period, index) => {
    const start = 4 + index * 4;
    worksheet.mergeCells(1, start, 1, start + 3);
    worksheet.getCell(1, start).value = period;
    [
      "Начислено по окладу, ₽",
      "Отпускные, ₽",
      "Премия, ₽",
      "Бонус от продаж, ₽",
    ].forEach((header, offset) => {
      worksheet.getCell(2, start + offset).value = header;
    });
  });
  return worksheet;
}

function addEmployee(
  worksheet: ExcelJS.Worksheet,
  row: number,
  fullName: string,
  direction: string,
  values: Array<number | string | null>,
) {
  worksheet.getCell(row, 1).value = fullName;
  worksheet.getCell(row, 2).value = "Специалист";
  worksheet.getCell(row, 3).value = direction;
  values.forEach((value, index) => {
    worksheet.getCell(row, 4 + index).value = value;
  });
}

describe("parsePayrollWorksheet", () => {
  it("разбирает двухстрочную шапку, месяцы и четыре вида начислений", () => {
    const worksheet = worksheetWithPeriods(["Январь 2026", "Февраль 2026"]);
    addEmployee(
      worksheet,
      3,
      "Иванов Иван",
      "  БРЕНДИНГ ",
      [100_000, null, 15_000, -500, 110_000, 2_000, 10_000, 1_000],
    );
    addEmployee(
      worksheet,
      4,
      "Петров Пётр",
      "Разработка сайта",
      ["200 000,00", 0, 20_000, 5_000, 210_000, 0, 25_000, 6_000],
    );

    const result = parsePayrollWorksheet(worksheet);

    expect(result.employeeCount).toBe(2);
    expect(result.latestPeriod).toEqual({ year: 2026, month: 2 });
    expect(result.aggregates).toHaveLength(4);
    expect(result.aggregates[0]).toMatchObject({
      year: 2026,
      month: 1,
      directionId: "branding",
      salary: "100000.00",
      vacationPay: "0.00",
      bonus: "15000.00",
      salesBonus: "-500.00",
    });
  });

  it("пропускает неизвестные направления, неполное ФИО, итог и пустые строки", () => {
    const worksheet = worksheetWithPeriods(["Апрель 2026"]);
    addEmployee(worksheet, 3, "Иванов Иван", "Управление", [1, 2, 3, 4]);
    addEmployee(worksheet, 4, "Иванов", "Брендинг", [1, 2, 3, 4]);
    addEmployee(worksheet, 5, "ИТОГО", "Брендинг", [1, 2, 3, 4]);
    addEmployee(worksheet, 7, "Петров Пётр", "SMM", [10, null, 2, 3]);

    const result = parsePayrollWorksheet(worksheet);

    expect(result.employeeCount).toBe(1);
    expect(result.aggregates).toEqual([
      {
        year: 2026,
        month: 4,
        directionId: "smm",
        salary: "10.00",
        vacationPay: "0.00",
        bonus: "2.00",
        salesBonus: "3.00",
      },
    ]);
  });

  it("отклоняет повтор периода и нарушенную последовательность заголовков", () => {
    const duplicate = worksheetWithPeriods(["Март 2026", "Март 2026"]);
    expect(() => parsePayrollWorksheet(duplicate)).toThrow("указан повторно");

    const invalidHeader = worksheetWithPeriods(["Март 2026"]);
    invalidHeader.getCell(2, 5).value = "Премия, ₽";
    expect(() => parsePayrollWorksheet(invalidHeader)).toThrow(
      "Нарушена последовательность начислений",
    );
  });

  it("отклоняет некорректную сумму только у подходящего сотрудника", () => {
    const invalidKnown = worksheetWithPeriods(["Май 2026"]);
    addEmployee(invalidKnown, 3, "Иванов Иван", "Брендинг", ["ошибка", 0, 0, 0]);
    expect(() => parsePayrollWorksheet(invalidKnown)).toThrow(
      "Некорректная сумма в строке 3, столбце 4",
    );

    const invalidUnknown = worksheetWithPeriods(["Май 2026"]);
    addEmployee(invalidUnknown, 3, "Иванов Иван", "Продажи", ["ошибка", 0, 0, 0]);
    expect(parsePayrollWorksheet(invalidUnknown).aggregates).toEqual([]);
  });
});
