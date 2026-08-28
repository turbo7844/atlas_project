import { createHash } from "node:crypto";

import {
  Prisma,
  SyncStatus,
  SyncTrigger,
} from "@prisma/client";

import type { DataConnector } from "@/connectors/types";
import { GoogleMarketingPlanConnector } from "@/connectors/google-marketing-plan";
import { env } from "@/lib/env";
import { prisma } from "@/lib/prisma";
import {
  normalizePlanRows,
  parseMarketingPlanCsv,
} from "@/services/marketing-plan-parser";

const ADVISORY_LOCK_KEY = 728_401;

export interface SyncResult {
  runId: string;
  status: SyncStatus;
  changed: boolean;
  rowCount: number;
  finishedAt: string;
  message: string;
}

function errorMessage(error: unknown) {
  if (error instanceof Error) {
    if (error.name === "AbortError") {
      return "Google-таблица не ответила за 20 секунд.";
    }
    return error.message.slice(0, 1_000);
  }
  return "Неизвестная ошибка синхронизации.";
}

export async function synchronizeMarketingPlan(
  trigger: SyncTrigger,
  connector: DataConnector = new GoogleMarketingPlanConnector(),
): Promise<SyncResult> {
  const source = await prisma.dataSource.upsert({
    where: { key: connector.key },
    update: {
      enabled: true,
      syncIntervalMinutes: env.syncIntervalMinutes,
    },
    create: {
      key: connector.key,
      name: "Маркетинговый план Google Sheets",
      type: "GOOGLE_SHEETS_CSV",
      syncIntervalMinutes: env.syncIntervalMinutes,
    },
  });

  const run = await prisma.syncRun.create({
    data: {
      sourceId: source.id,
      trigger,
      status: SyncStatus.RUNNING,
    },
  });

  try {
    const result = await prisma.$transaction(
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
              errorMessage: "Синхронизация уже выполняется.",
            },
          });
          return {
            runId: run.id,
            status: SyncStatus.SKIPPED,
            changed: false,
            rowCount: 0,
            finishedAt: finishedAt.toISOString(),
            message: "Синхронизация уже выполняется.",
          };
        }

        const payload = await connector.load();
        const rows = parseMarketingPlanCsv(
          payload.raw,
          env.marketingPlanYear,
        );
        const normalized = normalizePlanRows(rows);
        const hash = createHash("sha256")
          .update(JSON.stringify(normalized))
          .digest("hex");
        const latestSnapshot =
          await transaction.marketingPlanSnapshot.findFirst({
            where: { sourceId: source.id },
            orderBy: { createdAt: "desc" },
            select: { contentHash: true },
          });
        const changed = latestSnapshot?.contentHash !== hash;

        if (changed) {
          await transaction.marketingPlanSnapshot.create({
            data: {
              sourceId: source.id,
              syncRunId: run.id,
              year: env.marketingPlanYear,
              contentHash: hash,
              rawPayload: payload.raw,
              values: {
                create: rows.map((row) => ({
                  directionId: row.directionId,
                  month: row.month,
                  visits: row.visits,
                  leads: row.leads,
                  budget: new Prisma.Decimal(row.budget.toFixed(2)),
                  conversion: new Prisma.Decimal(
                    row.conversion.toFixed(6),
                  ),
                  cpc: new Prisma.Decimal(row.cpc.toFixed(2)),
                  cpl: new Prisma.Decimal(row.cpl.toFixed(2)),
                })),
              },
            },
          });
        }

        const finishedAt = new Date();
        await transaction.syncRun.update({
          where: { id: run.id },
          data: {
            status: SyncStatus.SUCCESS,
            changed,
            rowCount: rows.length,
            contentHash: hash,
            finishedAt,
          },
        });

        return {
          runId: run.id,
          status: SyncStatus.SUCCESS,
          changed,
          rowCount: rows.length,
          finishedAt: finishedAt.toISOString(),
          message: changed
            ? "Маркетинговый план обновлён."
            : "Изменений в маркетинговом плане нет.",
        };
      },
      { maxWait: 5_000, timeout: 30_000 },
    );

    return result;
  } catch (error) {
    const message = errorMessage(error);
    const finishedAt = new Date();
    await prisma.syncRun.update({
      where: { id: run.id },
      data: {
        status: SyncStatus.FAILED,
        finishedAt,
        changed: false,
        errorMessage: message,
      },
    });
    throw new Error(message);
  }
}

export async function getMarketingPlanSyncStatus() {
  const source = await prisma.dataSource.findUnique({
    where: { key: "google-marketing-plan" },
    include: {
      syncRuns: {
        orderBy: { startedAt: "desc" },
        take: 1,
      },
      snapshots: {
        orderBy: { createdAt: "desc" },
        take: 1,
        select: {
          id: true,
          year: true,
          createdAt: true,
          contentHash: true,
          _count: { select: { values: true } },
        },
      },
    },
  });

  const run = source?.syncRuns[0] ?? null;
  const snapshot = source?.snapshots[0] ?? null;

  return {
    source: source
      ? {
          key: source.key,
          name: source.name,
          intervalMinutes: source.syncIntervalMinutes,
        }
      : null,
    lastRun: run
      ? {
          id: run.id,
          trigger: run.trigger,
          status: run.status,
          startedAt: run.startedAt.toISOString(),
          finishedAt: run.finishedAt?.toISOString() ?? null,
          rowCount: run.rowCount,
          changed: run.changed,
          errorMessage: run.errorMessage,
        }
      : null,
    snapshot: snapshot
      ? {
          id: snapshot.id,
          year: snapshot.year,
          createdAt: snapshot.createdAt.toISOString(),
          rowCount: snapshot._count.values,
        }
      : null,
  };
}
