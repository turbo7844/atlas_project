import { createHash } from "node:crypto";

import { Prisma, SyncStatus, SyncTrigger } from "@prisma/client";

import { env } from "@/lib/env";
import { prisma } from "@/lib/prisma";
import {
  normalizePayrollAggregates,
  type ParsedPayroll,
} from "@/services/payroll-xlsx-parser";
import { loadPayrollXlsx } from "@/services/payroll-xlsx-source";

const SOURCE_KEY = "local-payroll-xlsx";
const ADVISORY_LOCK_KEY = 24_083_101;

type PayrollLoader = () => Promise<ParsedPayroll>;

function errorMessage(error: unknown) {
  return error instanceof Error
    ? error.message
    : "Не удалось синхронизировать начисления ФОТ.";
}

async function ensurePayrollSource() {
  const source = await prisma.dataSource.upsert({
    where: { key: SOURCE_KEY },
    update: {
      name: "Начисления ФОТ из локального XLSX",
      type: "LOCAL_XLSX",
      enabled: true,
      syncIntervalMinutes: 1,
    },
    create: {
      key: SOURCE_KEY,
      name: "Начисления ФОТ из локального XLSX",
      type: "LOCAL_XLSX",
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

export async function synchronizePayroll(
  trigger: SyncTrigger = SyncTrigger.AUTOMATIC,
  loader: PayrollLoader = loadPayrollXlsx,
) {
  const source = await ensurePayrollSource();
  const run = await prisma.syncRun.create({
    data: {
      sourceId: source.id,
      trigger,
      status: SyncStatus.RUNNING,
    },
  });

  try {
    return await prisma.$transaction(
      async (transaction) => {
        const locks = await transaction.$queryRaw<Array<{ acquired: boolean }>>(
          Prisma.sql`SELECT pg_try_advisory_xact_lock(${ADVISORY_LOCK_KEY}) AS acquired`,
        );
        if (!locks[0]?.acquired) {
          const finishedAt = new Date();
          await transaction.syncRun.update({
            where: { id: run.id },
            data: {
              status: SyncStatus.SKIPPED,
              changed: false,
              rowCount: 0,
              finishedAt,
              errorMessage: "Синхронизация ФОТ уже выполняется.",
            },
          });
          return {
            runId: run.id,
            status: SyncStatus.SKIPPED,
            changed: false,
            rowCount: 0,
            finishedAt: finishedAt.toISOString(),
            message: "Синхронизация ФОТ уже выполняется.",
          };
        }

        const parsed = await loader();
        const normalized = normalizePayrollAggregates(parsed.aggregates);
        const hash = createHash("sha256")
          .update(JSON.stringify(normalized))
          .digest("hex");
        const state = await transaction.payrollSyncState.findUniqueOrThrow({
          where: { sourceId: source.id },
        });
        const changed = state.contentHash !== hash;
        const finishedAt = new Date();

        if (changed) {
          await transaction.payrollMonthly.deleteMany({
            where: { sourceId: source.id },
          });
          if (normalized.length) {
            await transaction.payrollMonthly.createMany({
              data: normalized.map((row) => ({
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
        }

        const syncState = await transaction.payrollSyncState.update({
          where: { sourceId: source.id },
          data: {
            contentHash: hash,
            lastSuccessAt: finishedAt,
            employeeCount: parsed.employeeCount,
            rowCount: normalized.length,
            latestYear: parsed.latestPeriod?.year ?? null,
            latestMonth: parsed.latestPeriod?.month ?? null,
            lastError: null,
            ...(changed ? { revision: { increment: 1 } } : {}),
          },
        });
        await transaction.syncRun.update({
          where: { id: run.id },
          data: {
            status: SyncStatus.SUCCESS,
            changed,
            rowCount: normalized.length,
            contentHash: hash,
            finishedAt,
          },
        });

        return {
          runId: run.id,
          status: SyncStatus.SUCCESS,
          changed,
          revision: syncState.revision,
          rowCount: normalized.length,
          employeeCount: parsed.employeeCount,
          finishedAt: finishedAt.toISOString(),
          message: changed
            ? "Начисления ФОТ обновлены."
            : "Изменений в начислениях ФОТ нет.",
        };
      },
      { maxWait: 5_000, timeout: 30_000 },
    );
  } catch (error) {
    const message = errorMessage(error);
    const finishedAt = new Date();
    await Promise.allSettled([
      prisma.syncRun.update({
        where: { id: run.id },
        data: {
          status: SyncStatus.FAILED,
          changed: false,
          finishedAt,
          errorMessage: message,
        },
      }),
      prisma.payrollSyncState.upsert({
        where: { sourceId: source.id },
        update: { lastError: message },
        create: { sourceId: source.id, lastError: message },
      }),
    ]);
    throw new Error(message);
  }
}

export async function getPayrollSyncStatus() {
  const source = await prisma.dataSource.findUnique({
    where: { key: SOURCE_KEY },
    include: {
      payrollSyncState: true,
      syncRuns: { orderBy: { startedAt: "desc" }, take: 1 },
    },
  });
  const state = source?.payrollSyncState ?? null;
  const run = source?.syncRuns[0] ?? null;
  return {
    configured: Boolean(env.payrollXlsxDirectory && env.payrollXlsxFilename),
    status: run?.status ?? "NOT_STARTED",
    revision: state?.revision ?? 0,
    lastSuccessAt: state?.lastSuccessAt?.toISOString() ?? null,
    employeeCount: state?.employeeCount ?? 0,
    aggregateCount: state?.rowCount ?? 0,
    latestPeriod:
      state?.latestYear && state.latestMonth
        ? `${state.latestYear}-${String(state.latestMonth).padStart(2, "0")}`
        : null,
    error: state?.lastError ?? run?.errorMessage ?? null,
  };
}
