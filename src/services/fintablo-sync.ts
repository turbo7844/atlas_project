import { createHash } from "node:crypto";

import { Prisma, SyncStatus, SyncTrigger } from "@prisma/client";

import { env } from "@/lib/env";
import { prisma } from "@/lib/prisma";
import {
  FintabloApiError,
  loadFintabloCashFlow,
  type FintabloCashFlowSnapshot,
} from "@/services/fintablo-client";

const SOURCE_KEY = "fintablo-cash-flow";
const ADVISORY_LOCK_KEY = 24_090_801;

type FintabloLoader = () => Promise<FintabloCashFlowSnapshot>;

function compareExternalId(
  left: { externalId: string },
  right: { externalId: string },
) {
  return left.externalId.localeCompare(right.externalId, "ru", {
    numeric: true,
  });
}

function canonicalJson(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalJson);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, item]) => [key, canonicalJson(item)]),
    );
  }
  return value;
}

export function normalizeFintabloSnapshot(
  snapshot: FintabloCashFlowSnapshot,
) {
  return {
    categories: [...snapshot.categories].sort(compareExternalId).map((item) => ({
      externalId: item.externalId,
      parentExternalId: item.parentExternalId,
      name: item.name,
      group: item.group,
      type: item.type,
      pnlType: item.pnlType,
      description: item.description,
      isBuiltIn: item.isBuiltIn,
      raw: canonicalJson(item.raw),
    })),
    directions: [...snapshot.directions].sort(compareExternalId).map((item) => ({
      externalId: item.externalId,
      parentExternalId: item.parentExternalId,
      name: item.name,
      description: item.description,
      archived: item.archived,
      raw: canonicalJson(item.raw),
    })),
    transactions: [...snapshot.transactions]
      .sort(compareExternalId)
      .map((item) => ({
        externalId: item.externalId,
        parentExternalId: item.parentExternalId,
        categoryExternalId: item.categoryExternalId,
        directionExternalId: item.directionExternalId,
        moneybagExternalId: item.moneybagExternalId,
        moneybag2ExternalId: item.moneybag2ExternalId,
        group: item.group,
        amount: item.amount.toFixed(2),
        amount2: item.amount2?.toFixed(2) ?? null,
        description: item.description,
        date: item.date.toISOString().slice(0, 10),
        timestamp: item.timestamp?.toString() ?? null,
        isPlan: item.isPlan,
        raw: canonicalJson(item.raw),
      })),
  };
}

export function hashFintabloSnapshot(snapshot: FintabloCashFlowSnapshot) {
  return createHash("sha256")
    .update(JSON.stringify(normalizeFintabloSnapshot(snapshot)))
    .digest("hex");
}

function internalId(
  sourceId: string,
  entity: "category" | "direction" | "transaction",
  externalId: string,
) {
  return `${sourceId}:${entity}:${externalId}`;
}

function errorMessage(error: unknown) {
  if (error instanceof Error) return error.message.slice(0, 1_000);
  return "Не удалось синхронизировать фактический ДДС FinTablo.";
}

async function ensureFintabloSource() {
  const source = await prisma.dataSource.upsert({
    where: { key: SOURCE_KEY },
    update: {
      name: "Фактический ДДС FinTablo",
      type: "FINTABLO_API",
      enabled: true,
      syncIntervalMinutes: env.fintabloSyncIntervalMinutes,
    },
    create: {
      key: SOURCE_KEY,
      name: "Фактический ДДС FinTablo",
      type: "FINTABLO_API",
      syncIntervalMinutes: env.fintabloSyncIntervalMinutes,
    },
  });
  await prisma.fintabloCashFlowSyncState.upsert({
    where: { sourceId: source.id },
    update: {},
    create: { sourceId: source.id },
  });
  return source;
}

export async function synchronizeFintabloCashFlow(
  trigger: SyncTrigger = SyncTrigger.AUTOMATIC,
  loader: FintabloLoader = loadFintabloCashFlow,
) {
  const source = await ensureFintabloSource();
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
          const message = "Синхронизация ДДС FinTablo уже выполняется.";
          await transaction.syncRun.update({
            where: { id: run.id },
            data: {
              status: SyncStatus.SKIPPED,
              changed: false,
              rowCount: 0,
              finishedAt,
              errorMessage: message,
            },
          });
          return {
            runId: run.id,
            status: SyncStatus.SKIPPED,
            changed: false,
            rowCount: 0,
            finishedAt: finishedAt.toISOString(),
            message,
          };
        }

        const snapshot = await loader();
        const normalized = normalizeFintabloSnapshot(snapshot);
        const hash = createHash("sha256")
          .update(JSON.stringify(normalized))
          .digest("hex");
        const state =
          await transaction.fintabloCashFlowSyncState.findUniqueOrThrow({
            where: { sourceId: source.id },
          });
        const changed = state.contentHash !== hash;

        if (changed) {
          await transaction.fintabloTransaction.deleteMany({
            where: { sourceId: source.id },
          });
          await transaction.fintabloCategory.deleteMany({
            where: { sourceId: source.id },
          });
          await transaction.fintabloDirection.deleteMany({
            where: { sourceId: source.id },
          });

          if (normalized.categories.length) {
            await transaction.fintabloCategory.createMany({
              data: normalized.categories.map((item) => ({
                id: internalId(source.id, "category", item.externalId),
                sourceId: source.id,
                externalId: item.externalId,
                parentExternalId: item.parentExternalId,
                name: item.name,
                group: item.group,
                type: item.type,
                pnlType: item.pnlType,
                description: item.description,
                isBuiltIn: item.isBuiltIn,
                raw: item.raw as Prisma.InputJsonValue,
              })),
            });
          }
          if (normalized.directions.length) {
            await transaction.fintabloDirection.createMany({
              data: normalized.directions.map((item) => ({
                id: internalId(source.id, "direction", item.externalId),
                sourceId: source.id,
                externalId: item.externalId,
                parentExternalId: item.parentExternalId,
                name: item.name,
                description: item.description,
                archived: item.archived,
                raw: item.raw as Prisma.InputJsonValue,
              })),
            });
          }

          const categoryIds = new Set(
            normalized.categories.map((item) => item.externalId),
          );
          const directionIds = new Set(
            normalized.directions.map((item) => item.externalId),
          );
          if (normalized.transactions.length) {
            await transaction.fintabloTransaction.createMany({
              data: normalized.transactions.map((item) => ({
                id: internalId(source.id, "transaction", item.externalId),
                sourceId: source.id,
                externalId: item.externalId,
                parentExternalId: item.parentExternalId,
                categoryExternalId: item.categoryExternalId,
                categoryId:
                  item.categoryExternalId &&
                  categoryIds.has(item.categoryExternalId)
                    ? internalId(
                        source.id,
                        "category",
                        item.categoryExternalId,
                      )
                    : null,
                directionExternalId: item.directionExternalId,
                directionId:
                  item.directionExternalId &&
                  directionIds.has(item.directionExternalId)
                    ? internalId(
                        source.id,
                        "direction",
                        item.directionExternalId,
                      )
                    : null,
                moneybagExternalId: item.moneybagExternalId,
                moneybag2ExternalId: item.moneybag2ExternalId,
                group: item.group,
                amount: new Prisma.Decimal(item.amount),
                amount2: item.amount2
                  ? new Prisma.Decimal(item.amount2)
                  : null,
                description: item.description,
                date: new Date(`${item.date}T00:00:00.000Z`),
                timestamp: item.timestamp ? BigInt(item.timestamp) : null,
                isPlan: item.isPlan,
                raw: item.raw as Prisma.InputJsonValue,
              })),
            });
          }
        }

        const maxDate =
          snapshot.transactions.reduce<Date | null>(
            (latest, item) =>
              !latest || item.date > latest ? item.date : latest,
            null,
          );
        const finishedAt = new Date();
        const syncState =
          await transaction.fintabloCashFlowSyncState.update({
            where: { sourceId: source.id },
            data: {
              contentHash: hash,
              lastSuccessAt: finishedAt,
              rowCount: snapshot.transactions.length,
              maxDate,
              lastRequestId: snapshot.requestIds.at(-1) ?? null,
              lastError: null,
              ...(changed ? { revision: { increment: 1 } } : {}),
            },
          });
        await transaction.syncRun.update({
          where: { id: run.id },
          data: {
            status: SyncStatus.SUCCESS,
            changed,
            rowCount: snapshot.transactions.length,
            contentHash: hash,
            finishedAt,
          },
        });

        return {
          runId: run.id,
          status: SyncStatus.SUCCESS,
          changed,
          revision: syncState.revision,
          rowCount: snapshot.transactions.length,
          finishedAt: finishedAt.toISOString(),
          message: changed
            ? "Фактический ДДС FinTablo обновлён."
            : "Изменений в фактическом ДДС FinTablo нет.",
        };
      },
      { maxWait: 5_000, timeout: 180_000 },
    );
  } catch (error) {
    const message = errorMessage(error);
    const finishedAt = new Date();
    const requestId =
      error instanceof FintabloApiError ? error.requestId : null;
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
      prisma.fintabloCashFlowSyncState.upsert({
        where: { sourceId: source.id },
        update: {
          lastError: message,
          ...(requestId ? { lastRequestId: requestId } : {}),
        },
        create: {
          sourceId: source.id,
          lastError: message,
          lastRequestId: requestId,
        },
      }),
    ]);
    throw new Error(message);
  }
}

export async function getFintabloCashFlowSyncStatus() {
  const source = await prisma.dataSource.findUnique({
    where: { key: SOURCE_KEY },
    include: {
      fintabloCashFlowSyncState: true,
      syncRuns: { orderBy: { startedAt: "desc" }, take: 1 },
    },
  });
  const state = source?.fintabloCashFlowSyncState ?? null;
  const run = source?.syncRuns[0] ?? null;
  return {
    configured: Boolean(env.fintabloApiKey),
    status: run?.status ?? "NOT_STARTED",
    revision: state?.revision ?? 0,
    lastSuccessAt: state?.lastSuccessAt?.toISOString() ?? null,
    rowCount: state?.rowCount ?? 0,
    maxDate: state?.maxDate?.toISOString().slice(0, 10) ?? null,
    error: state?.lastError ?? run?.errorMessage ?? null,
  };
}
