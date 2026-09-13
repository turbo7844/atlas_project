import { createHash } from "node:crypto";

import {
  Prisma,
  SyncStatus,
  SyncTrigger,
  type SalesMonthly,
} from "@prisma/client";

import {
  DIRECTION_BY_SOURCE_NAME,
  DIRECTIONS,
  type DirectionId,
} from "@/lib/constants";
import { env } from "@/lib/env";
import { prisma } from "@/lib/prisma";
import {
  loadBitrix24Sales,
  type Bitrix24Funnel,
  type Bitrix24SalesSnapshot,
} from "@/services/bitrix24-client";

const SOURCE_KEY = "bitrix24-sales";
const ADVISORY_LOCK_KEY = 24_091_401;

type Bitrix24SalesLoader = () => Promise<Bitrix24SalesSnapshot>;

export type BitrixSalesMonthlyRow = Pick<
  SalesMonthly,
  | "year"
  | "month"
  | "directionId"
  | "leads"
  | "meetings"
  | "proposals"
  | "contracts"
  | "payments"
  | "revenue"
>;

export type BitrixSalesAggregate = {
  rows: BitrixSalesMonthlyRow[];
  dealCount: number;
  funnelCount: number;
  ignoredDealCount: number;
  minDealDate: Date | null;
  maxDealDate: Date | null;
  maxRevenueDate: Date | null;
};

const PROCESS_STAGE_RANK = new Map([
  ["Новый лид", 0],
  ["Встреча проведена", 1],
  ["КП выставлено", 2],
  ["Договор подписан", 3],
]);

function dateFromKey(value: string) {
  return new Date(`${value}T00:00:00.000Z`);
}

function earlierDate(current: Date | null, candidate: Date) {
  return !current || candidate.getTime() < current.getTime()
    ? candidate
    : current;
}

function laterDate(current: Date | null, candidate: Date) {
  return !current || candidate.getTime() > current.getTime()
    ? candidate
    : current;
}

function monthKey(value: string, directionId: DirectionId) {
  return `${value.slice(0, 7)}:${directionId}`;
}

function emptyRow(value: string, directionId: DirectionId) {
  return {
    year: Number(value.slice(0, 4)),
    month: Number(value.slice(5, 7)),
    directionId,
    leads: 0,
    meetings: 0,
    proposals: 0,
    contracts: 0,
    payments: 0,
    revenue: new Prisma.Decimal(0),
  } satisfies BitrixSalesMonthlyRow;
}

function mappedFunnels(funnels: Bitrix24Funnel[]) {
  const result = new Map<
    number,
    { directionId: DirectionId; funnel: Bitrix24Funnel }
  >();
  const mappedDirections = new Set<DirectionId>();

  for (const funnel of funnels) {
    const directionId = DIRECTION_BY_SOURCE_NAME.get(funnel.name);
    if (!directionId) continue;
    if (mappedDirections.has(directionId)) {
      throw new Error(
        `В Bitrix24 найдено несколько воронок для направления «${funnel.name}».`,
      );
    }
    mappedDirections.add(directionId);
    result.set(funnel.id, { directionId, funnel });
  }

  const missing = DIRECTIONS.filter(
    (direction) => !mappedDirections.has(direction.id),
  );
  if (missing.length) {
    throw new Error(
      `В Bitrix24 не найдены воронки: ${missing
        .map((direction) => direction.name)
        .join(", ")}.`,
    );
  }
  return result;
}

function stageRank(funnel: Bitrix24Funnel, stageId: string) {
  const stage = funnel.stages.find((item) => item.id === stageId);
  if (!stage) {
    throw new Error(
      `Воронка «${funnel.name}» не содержит стадию ${stageId}.`,
    );
  }
  if (stage.semantics === "failure") return -1;
  if (stage.semantics === "success") return 4;
  const rank = PROCESS_STAGE_RANK.get(stage.name);
  if (rank === undefined) {
    throw new Error(
      `Не настроено соответствие стадии «${stage.name}» воронки «${funnel.name}».`,
    );
  }
  return rank;
}

export function aggregateBitrixSales(
  snapshot: Bitrix24SalesSnapshot,
): BitrixSalesAggregate {
  const funnels = mappedFunnels(snapshot.funnels);
  const rows = new Map<string, BitrixSalesMonthlyRow>();
  let ignoredDealCount = 0;
  let minDealDate: Date | null = null;
  let maxDealDate: Date | null = null;
  let maxRevenueDate: Date | null = null;

  const getRow = (date: string, directionId: DirectionId) => {
    const key = monthKey(date, directionId);
    const row = rows.get(key) ?? emptyRow(date, directionId);
    rows.set(key, row);
    return row;
  };

  for (const deal of snapshot.deals) {
    const mapping = funnels.get(deal.categoryId);
    if (!mapping) {
      ignoredDealCount += 1;
      continue;
    }

    const dealDate = dateFromKey(deal.createdDate);
    minDealDate = earlierDate(minDealDate, dealDate);
    maxDealDate = laterDate(maxDealDate, dealDate);

    const funnelRow = getRow(deal.createdDate, mapping.directionId);
    const rank = stageRank(mapping.funnel, deal.stageId);
    funnelRow.leads += 1;
    if (rank >= 1) funnelRow.meetings += 1;
    if (rank >= 2) funnelRow.proposals += 1;
    if (rank >= 3) funnelRow.contracts += 1;
    if (rank >= 4) funnelRow.payments += 1;

    if (rank === 4) {
      if (!deal.closedDate) {
        throw new Error(
          `У оплаченной сделки ${deal.id} не заполнена дата закрытия.`,
        );
      }
      if (deal.currencyId !== "RUB") {
        throw new Error(
          `Сделка ${deal.id} использует валюту ${deal.currencyId}; курс пересчёта в RUB не настроен.`,
        );
      }
      const revenueDate = dateFromKey(deal.closedDate);
      maxRevenueDate = laterDate(maxRevenueDate, revenueDate);
      const revenueRow = getRow(deal.closedDate, mapping.directionId);
      revenueRow.revenue = revenueRow.revenue.add(deal.opportunity);
    }
  }

  return {
    rows: [...rows.values()].sort(
      (left, right) =>
        left.year - right.year ||
        left.month - right.month ||
        left.directionId.localeCompare(right.directionId),
    ),
    dealCount: snapshot.deals.length,
    funnelCount: funnels.size,
    ignoredDealCount,
    minDealDate,
    maxDealDate,
    maxRevenueDate,
  };
}

function normalizedAggregate(aggregate: BitrixSalesAggregate) {
  return aggregate.rows.map((row) => ({
    year: row.year,
    month: row.month,
    directionId: row.directionId,
    leads: row.leads,
    meetings: row.meetings,
    proposals: row.proposals,
    contracts: row.contracts,
    payments: row.payments,
    revenue: row.revenue.toFixed(2),
  }));
}

export function hashBitrixSales(aggregate: BitrixSalesAggregate) {
  return createHash("sha256")
    .update(JSON.stringify(normalizedAggregate(aggregate)))
    .digest("hex");
}

function syncErrorMessage(error: unknown) {
  return error instanceof Error
    ? error.message.slice(0, 1_000)
    : "Не удалось синхронизировать продажи Bitrix24.";
}

async function ensureSource() {
  const source = await prisma.dataSource.upsert({
    where: { key: SOURCE_KEY },
    update: {
      name: "Продажи и выручка Bitrix24",
      type: "BITRIX24_WEBHOOK",
      enabled: true,
      syncIntervalMinutes: env.bitrix24SyncIntervalMinutes,
    },
    create: {
      key: SOURCE_KEY,
      name: "Продажи и выручка Bitrix24",
      type: "BITRIX24_WEBHOOK",
      syncIntervalMinutes: env.bitrix24SyncIntervalMinutes,
    },
  });
  await prisma.bitrixSalesSyncState.upsert({
    where: { sourceId: source.id },
    update: {},
    create: { sourceId: source.id },
  });
  return source;
}

export async function synchronizeBitrixSales(
  trigger: SyncTrigger = SyncTrigger.AUTOMATIC,
  loader: Bitrix24SalesLoader = loadBitrix24Sales,
) {
  const source = await ensureSource();
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
          const message = "Синхронизация Bitrix24 уже выполняется.";
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
        const aggregate = aggregateBitrixSales(snapshot);
        const hash = hashBitrixSales(aggregate);
        const state = await transaction.bitrixSalesSyncState.findUniqueOrThrow({
          where: { sourceId: source.id },
        });
        const changed = state.contentHash !== hash;

        if (changed) {
          await transaction.salesMonthly.deleteMany();
          if (aggregate.rows.length) {
            await transaction.salesMonthly.createMany({
              data: aggregate.rows,
            });
          }
        }

        const finishedAt = new Date();
        const syncState = await transaction.bitrixSalesSyncState.update({
          where: { sourceId: source.id },
          data: {
            contentHash: hash,
            lastSuccessAt: finishedAt,
            dealCount: aggregate.dealCount,
            funnelCount: aggregate.funnelCount,
            ignoredDealCount: aggregate.ignoredDealCount,
            minDealDate: aggregate.minDealDate,
            maxDealDate: aggregate.maxDealDate,
            maxRevenueDate: aggregate.maxRevenueDate,
            lastError: null,
            ...(changed ? { revision: { increment: 1 } } : {}),
          },
        });
        await transaction.syncRun.update({
          where: { id: run.id },
          data: {
            status: SyncStatus.SUCCESS,
            changed,
            rowCount: aggregate.dealCount,
            contentHash: hash,
            finishedAt,
          },
        });

        return {
          runId: run.id,
          status: SyncStatus.SUCCESS,
          changed,
          revision: syncState.revision,
          rowCount: aggregate.dealCount,
          finishedAt: finishedAt.toISOString(),
          message: changed
            ? "Продажи и выручка Bitrix24 обновлены."
            : "Изменений в продажах Bitrix24 нет.",
        };
      },
      { maxWait: 5_000, timeout: 180_000 },
    );
  } catch (error) {
    const message = syncErrorMessage(error);
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
      prisma.bitrixSalesSyncState.upsert({
        where: { sourceId: source.id },
        update: { lastError: message },
        create: { sourceId: source.id, lastError: message },
      }),
    ]);
    throw new Error(message);
  }
}

export async function getBitrixSalesSyncStatus() {
  const source = await prisma.dataSource.findUnique({
    where: { key: SOURCE_KEY },
    include: {
      bitrixSalesSyncState: true,
      syncRuns: { orderBy: { startedAt: "desc" }, take: 1 },
    },
  });
  const state = source?.bitrixSalesSyncState ?? null;
  const run = source?.syncRuns[0] ?? null;
  return {
    configured: Boolean(env.bitrix24WebhookUrl),
    status: run?.status ?? "NOT_STARTED",
    revision: state?.revision ?? 0,
    lastSuccessAt: state?.lastSuccessAt?.toISOString() ?? null,
    dealCount: state?.dealCount ?? 0,
    funnelCount: state?.funnelCount ?? 0,
    ignoredDealCount: state?.ignoredDealCount ?? 0,
    minDate: state?.minDealDate?.toISOString().slice(0, 10) ?? null,
    maxDate: state?.maxDealDate?.toISOString().slice(0, 10) ?? null,
    maxRevenueDate:
      state?.maxRevenueDate?.toISOString().slice(0, 10) ?? null,
    error: state?.lastError ?? run?.errorMessage ?? null,
  };
}
