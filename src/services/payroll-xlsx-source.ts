import { unwatchFile, watchFile } from "node:fs";
import { readFile, stat } from "node:fs/promises";
import path from "node:path";

import ExcelJS from "exceljs";

import { env } from "@/lib/env";
import {
  parsePayrollWorksheet,
  type ParsedPayroll,
} from "@/services/payroll-xlsx-parser";

const delay = (milliseconds: number) =>
  new Promise((resolve) => setTimeout(resolve, milliseconds));

export function getPayrollXlsxPath() {
  if (!env.payrollXlsxDirectory || !env.payrollXlsxFilename) {
    throw new Error(
      "Не заданы PAYROLL_XLSX_DIRECTORY и PAYROLL_XLSX_FILENAME.",
    );
  }
  if (path.basename(env.payrollXlsxFilename) !== env.payrollXlsxFilename) {
    throw new Error("PAYROLL_XLSX_FILENAME должен содержать только имя файла.");
  }
  return path.resolve(env.payrollXlsxDirectory, env.payrollXlsxFilename);
}

async function waitForStableFile(filePath: string, deadline: number) {
  let previous: { size: number; mtimeMs: number } | null = null;
  while (Date.now() < deadline) {
    try {
      const current = await stat(filePath);
      const signature = { size: current.size, mtimeMs: current.mtimeMs };
      if (
        previous &&
        previous.size === signature.size &&
        previous.mtimeMs === signature.mtimeMs
      ) {
        return;
      }
      previous = signature;
    } catch {
      previous = null;
    }
    await delay(200);
  }
  throw new Error("Файл начислений не стабилизировался после сохранения.");
}

export async function loadPayrollXlsx(
  filePath = getPayrollXlsxPath(),
): Promise<ParsedPayroll> {
  const deadline = Date.now() + 5_000;
  let lastError: unknown = null;
  let workbook: ExcelJS.Workbook | null = null;

  while (Date.now() < deadline) {
    try {
      await waitForStableFile(filePath, deadline);
      const candidate = new ExcelJS.Workbook();
      const buffer = await readFile(filePath);
      await candidate.xlsx.load(
        buffer as unknown as Parameters<typeof candidate.xlsx.load>[0],
      );
      workbook = candidate;
      break;
    } catch (error) {
      lastError = error;
      if (Date.now() < deadline) await delay(250);
    }
  }

  if (!workbook) {
    const detail =
      lastError instanceof Error ? lastError.message : "неизвестная ошибка";
    throw new Error(`Не удалось прочитать XLSX с начислениями: ${detail}`);
  }
  const worksheet = workbook.worksheets[0];
  if (!worksheet) throw new Error("В книге начислений нет листов.");
  return parsePayrollWorksheet(worksheet);
}

export function watchPayrollXlsx(onChange: () => void) {
  const filePath = getPayrollXlsxPath();
  watchFile(filePath, { interval: 500, persistent: true }, (current, previous) => {
    if (
      current.size !== previous.size ||
      current.mtimeMs !== previous.mtimeMs
    ) {
      onChange();
    }
  });
  return () => unwatchFile(filePath);
}
