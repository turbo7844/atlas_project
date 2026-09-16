import { NextResponse } from "next/server";

import { requireAdmin } from "@/lib/auth/server";
import {
  importPayrollWorkbook,
  MAX_PAYROLL_FILE_SIZE,
  parsePayrollXlsxBuffer,
  PayrollImportBusyError,
  payrollFileHash,
} from "@/services/payroll-import";
import type {
  PayrollConflictResolution,
  PayrollImportDecision,
} from "@/types/payroll-import";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function parseDecisions(value: FormDataEntryValue | null) {
  if (value === null || value === "") return [];
  if (typeof value !== "string") {
    throw new Error("Решения по расхождениям должны быть переданы текстом.");
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    throw new Error("Некорректный список решений по расхождениям.");
  }
  if (!Array.isArray(parsed)) {
    throw new Error("Некорректный список решений по расхождениям.");
  }

  const result: PayrollImportDecision[] = [];
  const seen = new Set<string>();
  for (const item of parsed) {
    if (!item || typeof item !== "object" || Array.isArray(item)) {
      throw new Error("Некорректное решение по расхождению.");
    }
    const key = (item as Record<string, unknown>).key;
    const fingerprint = (item as Record<string, unknown>).fingerprint;
    const resolution = (item as Record<string, unknown>).resolution;
    if (
      typeof key !== "string" ||
      !key ||
      typeof fingerprint !== "string" ||
      !/^[a-f0-9]{64}$/.test(fingerprint) ||
      (resolution !== "keep" && resolution !== "replace") ||
      seen.has(key)
    ) {
      throw new Error("Некорректное решение по расхождению.");
    }
    seen.add(key);
    result.push({
      key,
      fingerprint,
      resolution: resolution as PayrollConflictResolution,
    });
  }
  return result;
}

export async function POST(request: Request) {
  const denied = await requireAdmin();
  if (denied) return denied;

  try {
    const formData = await request.formData();
    const file = formData.get("file");
    if (!(file instanceof File)) {
      return NextResponse.json(
        { error: "Выберите XLSX-файл с начислениями." },
        { status: 400 },
      );
    }
    if (!file.name.toLocaleLowerCase("ru-RU").endsWith(".xlsx")) {
      return NextResponse.json(
        { error: "Поддерживаются только файлы в формате .xlsx." },
        { status: 415 },
      );
    }
    if (file.size === 0) {
      return NextResponse.json(
        { error: "Выбранный файл пуст." },
        { status: 400 },
      );
    }
    if (file.size > MAX_PAYROLL_FILE_SIZE) {
      return NextResponse.json(
        { error: "Размер файла не должен превышать 20 МБ." },
        { status: 413 },
      );
    }

    const decisions = parseDecisions(formData.get("decisions"));
    const buffer = Buffer.from(await file.arrayBuffer());
    const result = await importPayrollWorkbook({
      parsed: await parsePayrollXlsxBuffer(buffer),
      fileHash: payrollFileHash(buffer),
      decisions,
    });
    return NextResponse.json(result, {
      status: result.status === "needs_confirmation" ? 409 : 200,
      headers: { "Cache-Control": "no-store" },
    });
  } catch (error) {
    const status = error instanceof PayrollImportBusyError ? 409 : 400;
    const detail =
      error instanceof Error && /[А-Яа-яЁё]/.test(error.message)
        ? error.message
        : "Не удалось импортировать начисления из XLSX.";
    return NextResponse.json(
      { error: detail },
      { status, headers: { "Cache-Control": "no-store" } },
    );
  }
}
