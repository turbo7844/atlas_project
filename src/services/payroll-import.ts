import { createHash } from "node:crypto";

import {
  Prisma,
  SyncStatus,
  SyncTrigger,
  type PayrollMonthly,
} from "@prisma/client";
import ExcelJS from "exceljs";

import {
  DIRECTIONS,
  PAYROLL_SOURCE_KEY,
  type DirectionId,
} from "@/lib/constants";
import { prisma } from "@/lib/prisma";
import {
  normalizePayrollAggregates,
  parsePayrollWorksheet,
  type ParsedPayroll,
  type PayrollAggregate,
} from "@/services/payroll-xlsx-parser";
import {
  PAYROLL_VALUE_FIELDS,
  type PayrollImportConflict,
  type PayrollImportConfirmation,
  type PayrollImportDecision,
  type PayrollImportResponse,
  type PayrollImportSummary,
  type PayrollValues,
} from "@/types/payroll-import";

export const MAX_PAYROLL_FILE_SIZE = 20 * 1024 * 1024;

const ADVISORY_LOCK_KEY = 24_083_101;
const directionNames = new Map(
  DIRECTIONS.map((direction) => [direction.id, direction.name]),
);

type ExistingPayroll = Pick<
  PayrollMonthly,
  | "year"
  | "month"
  | "directionId"
  | "salary"
  | "vacationPay"
  | "bonus"
  | "salesBonus"
>;

interface PayrollImportPlan {
  newRows: PayrollAggregate[];
  duplicateRows: PayrollAggregate[];
  conflicts: PayrollImportConflict[];
  summary: PayrollImportSummary;
}

export class PayrollImportBusyError extends Error {
  constructor() {
    super(
      "Другой импорт начислений уже выполняется. Повторите попытку через несколько секунд.",
    );
    this.name = "PayrollImportBusyError";
  }
}

export function payrollAggregateKey(
  row: { year: number; month: number; directionId: string },
) {
  return `${row.year}-${String(row.month).padStart(2, "0")}-${row.directionId}`;
}

function periodKey(row: Pick<PayrollAggregate, "year" | "month">) {
  return `${row.year}-${String(row.month).padStart(2, "0")}`;
}

function valuesFromAggregate(row: PayrollAggregate): PayrollValues {
  return {
    salary: new Prisma.Decimal(row.salary).toFixed(2),
    vacationPay: new Prisma.Decimal(row.vacationPay).toFixed(2),
    bonus: new Prisma.Decimal(row.bonus).toFixed(2),
    salesBonus: new Prisma.Decimal(row.salesBonus).toFixed(2),
  };
}

function valuesFromExisting(row: ExistingPayroll): PayrollValues {
  return {
    salary: row.salary.toFixed(2),
    vacationPay: row.vacationPay.toFixed(2),
    bonus: row.bonus.toFixed(2),
    salesBonus: row.salesBonus.toFixed(2),
  };
}

function payrollValuesEqual(left: PayrollValues, right: PayrollValues) {
  return PAYROLL_VALUE_FIELDS.every((field) => left[field] === right[field]);
}

function conflictFingerprint(
  key: string,
  existing: PayrollValues,
  incoming: PayrollValues,
) {
  return createHash("sha256")
    .update(JSON.stringify({ key, existing, incoming }))
    .digest("hex");
}

function periodBounds(rows: PayrollAggregate[]) {
  const periods = [...new Set(rows.map(periodKey))].sort();
  return {
    periodCount: periods.length,
    earliestPeriod: periods[0] ?? null,
    latestPeriod: periods.at(-1) ?? null,
  };
}

export function planPayrollImport(
  aggregates: PayrollAggregate[],
  existingRows: ExistingPayroll[],
  employeeCount: number,
): PayrollImportPlan {
  const normalized = normalizePayrollAggregates(aggregates);
  const existingByKey = new Map(
    existingRows.map((row) => [payrollAggregateKey(row), row]),
  );
  const newRows: PayrollAggregate[] = [];
  const duplicateRows: PayrollAggregate[] = [];
  const conflicts: PayrollImportConflict[] = [];

  for (const row of normalized) {
    const key = payrollAggregateKey(row);
    const existing = existingByKey.get(key);
    if (!existing) {
      newRows.push(row);
      continue;
    }

    const incomingValues = valuesFromAggregate(row);
    const existingValues = valuesFromExisting(existing);
    if (payrollValuesEqual(incomingValues, existingValues)) {
      duplicateRows.push(row);
      continue;
    }

    conflicts.push({
      key,
      fingerprint: conflictFingerprint(
        key,
        existingValues,
        incomingValues,
      ),
      year: row.year,
      month: row.month,
      directionId: row.directionId,
      directionName: directionNames.get(row.directionId) ?? row.directionId,
      existing: existingValues,
      incoming: incomingValues,
      changedFields: PAYROLL_VALUE_FIELDS.filter(
        (field) => existingValues[field] !== incomingValues[field],
      ),
    });
  }

  const bounds = periodBounds(normalized);
  return {
    newRows,
    duplicateRows,
    conflicts,
    summary: {
      ...bounds,
      aggregateCount: normalized.length,
      employeeCount,
      newCount: newRows.length,
      duplicateCount: duplicateRows.length,
      conflictCount: conflicts.length,
    },
  };
}

export async function parsePayrollXlsxBuffer(
  buffer: Buffer,
): Promise<ParsedPayroll> {
  const workbook = new ExcelJS.Workbook();
  try {
    await workbook.xlsx.load(
      buffer as unknown as Parameters<typeof workbook.xlsx.load>[0],
    );
  } catch {
    throw new Error(
      "Не удалось прочитать XLSX. Проверьте, что файл не повреждён и сохранён в формате .xlsx.",
    );
  }

  const worksheet = workbook.worksheets[0];
  if (!worksheet) throw new Error("В книге начислений нет листов.");
  return parsePayrollWorksheet(worksheet);
}

export function payrollFileHash(buffer: Buffer) {
  return createHash("sha256").update(buffer).digest("hex");
}

async function ensurePayrollSource() {
  const source = await prisma.dataSource.upsert({
    where: { key: PAYROLL_SOURCE_KEY },
    update: {
      name: "Начисления ФОТ из загружаемых XLSX",
      type: "UPLOADED_XLSX",
      enabled: true,
      syncIntervalMinutes: 1,
    },
    create: {
      key: PAYROLL_SOURCE_KEY,
      name: "Начисления ФОТ из загружаемых XLSX",
      type: "UPLOADED_XLSX",
      syncIntervalMinutes: 1,
    },
  });
  await prisma.payrollSyncState.upsert({
    where: { sourceId: source.id },
    update: {},
    create: { sourceId: source.id },
  });
  return source;
}

function confirmationResponse(
  fileHash: string,
  plan: PayrollImportPlan,
): PayrollImportConfirmation {
  return {
    status: "needs_confirmation",
    fileHash,
    summary: plan.summary,
    conflicts: plan.conflicts,
    message:
      "В файле есть значения за уже загруженные периоды, которые отличаются от сохранённых. Выберите действие для каждого расхождения.",
  };
}

function databaseContentHash(rows: ExistingPayroll[]) {
  const normalized = normalizePayrollAggregates(
    rows.map((row) => ({
      year: row.year,
      month: row.month,
      directionId: row.directionId as DirectionId,
      ...valuesFromExisting(row),
    })),
  );
  return createHash("sha256").update(JSON.stringify(normalized)).digest("hex");
}

function decisionsByKey(decisions: PayrollImportDecision[]) {
  return new Map(decisions.map((decision) => [decision.key, decision]));
}

export async function importPayrollWorkbook({
  parsed,
  fileHash,
  decisions = [],
}: {
  parsed: ParsedPayroll;
  fileHash: string;
  decisions?: PayrollImportDecision[];
}): Promise<PayrollImportResponse> {
  const source = await ensurePayrollSource();
  const selectedDecisions = decisionsByKey(decisions);

  return prisma.$transaction(
    async (transaction) => {
      const locks = await transaction.$queryRaw<Array<{ acquired: boolean }>>(
        Prisma.sql`SELECT pg_try_advisory_xact_lock(${ADVISORY_LOCK_KEY}) AS acquired`,
      );
      if (!locks[0]?.acquired) throw new PayrollImportBusyError();

      const existingRows = await transaction.payrollMonthly.findMany({
        where: { sourceId: source.id },
      });
      const plan = planPayrollImport(
        parsed.aggregates,
        existingRows,
        parsed.employeeCount,
      );
      const unanswered = plan.conflicts.some(
        (conflict) =>
          selectedDecisions.get(conflict.key)?.fingerprint !==
          conflict.fingerprint,
      );
      if (unanswered) return confirmationResponse(fileHash, plan);

      if (plan.newRows.length) {
        await transaction.payrollMonthly.createMany({
          data: plan.newRows.map((row) => ({
            sourceId: source.id,
            year: row.year,
            month: row.month,
            directionId: row.directionId,
            salary: new Prisma.Decimal(row.salary),
            vacationPay: new Prisma.Decimal(row.vacationPay),
            bonus: new Prisma.Decimal(row.bonus),
            salesBonus: new Prisma.Decimal(row.salesBonus),
          })),
        });
      }

      const incomingByKey = new Map(
        normalizePayrollAggregates(parsed.aggregates).map((row) => [
          payrollAggregateKey(row),
          row,
        ]),
      );
      const replacements = plan.conflicts.filter(
        (conflict) =>
          selectedDecisions.get(conflict.key)?.resolution === "replace",
      );
      for (const conflict of replacements) {
        const row = incomingByKey.get(conflict.key);
        if (!row) continue;
        await transaction.payrollMonthly.update({
          where: {
            sourceId_year_month_directionId: {
              sourceId: source.id,
              year: row.year,
              month: row.month,
              directionId: row.directionId,
            },
          },
          data: {
            salary: new Prisma.Decimal(row.salary),
            vacationPay: new Prisma.Decimal(row.vacationPay),
            bonus: new Prisma.Decimal(row.bonus),
            salesBonus: new Prisma.Decimal(row.salesBonus),
          },
        });
      }

      const finalRows = await transaction.payrollMonthly.findMany({
        where: { sourceId: source.id },
      });
      const latest = [...finalRows].sort(
        (left, right) => right.year - left.year || right.month - left.month,
      )[0];
      const changed = plan.newRows.length > 0 || replacements.length > 0;
      const finishedAt = new Date();
      const state = await transaction.payrollSyncState.update({
        where: { sourceId: source.id },
        data: {
          contentHash: databaseContentHash(finalRows),
          lastSuccessAt: finishedAt,
          employeeCount: parsed.employeeCount,
          rowCount: finalRows.length,
          latestYear: latest?.year ?? null,
          latestMonth: latest?.month ?? null,
          lastError: null,
          ...(changed ? { revision: { increment: 1 } } : {}),
        },
      });
      await transaction.syncRun.create({
        data: {
          sourceId: source.id,
          trigger: SyncTrigger.MANUAL,
          status: SyncStatus.SUCCESS,
          startedAt: finishedAt,
          finishedAt,
          rowCount: parsed.aggregates.length,
          changed,
          contentHash: fileHash,
        },
      });

      const keptCount = plan.conflicts.length - replacements.length;
      return {
        status: "imported",
        changed,
        revision: state.revision,
        insertedCount: plan.newRows.length,
        updatedCount: replacements.length,
        duplicateCount: plan.duplicateRows.length,
        keptCount,
        employeeCount: parsed.employeeCount,
        aggregateCount: parsed.aggregates.length,
        finishedAt: finishedAt.toISOString(),
        message: changed
          ? `Импорт завершён: добавлено ${plan.newRows.length}, обновлено ${replacements.length}.`
          : "Все данные из файла уже были загружены; повторные строки пропущены.",
      };
    },
    { maxWait: 5_000, timeout: 30_000 },
  );
}
