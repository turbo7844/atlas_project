import {
  MarketingActualSnapshotStatus,
  MarketingActualSyncMode,
  Prisma,
  SyncStatus,
  SyncTrigger,
} from "@prisma/client";

import { env } from "@/lib/env";
import { prisma } from "@/lib/prisma";
import {
  canonicalMarketingActualRows,
  directionName,
  hashMarketingActualRows,
  MARKETING_ACTUAL_HEADERS,
  MAX_MARKETING_ACTUAL_CHUNK_ROWS,
  MAX_MARKETING_ACTUAL_ROWS,
  type ParsedMarketingActualRow,
  validateMarketingActualHeaders,
  validateMarketingActualRows,
} from "@/services/marketing-actual-parser";
import { calculateMarketingMetrics } from "@/services/marketing-metrics";

const ADVISORY_LOCK_KEY = 728_402;
const SESSION_LIFETIME_MS = 15 * 60 * 1_000;
const IDENTIFIER_PATTERN = /^[A-Za-z0-9._:-]{1,160}$/;
const HASH_PATTERN = /^[a-f0-9]{64}$/;

type RecordValue = Record<string, unknown>;

type PatchCommand = {
  version: 1;
  mode: "patch";
  spreadsheetId: string;
  sheetName: string;
  affectedRows: number[];
  rows: ParsedMarketingActualRow[];
};

type SnapshotOfferCommand = {
  version: 1;
  mode: "snapshot.offer";
  spreadsheetId: string;
  sheetName: string;
  snapshotId: string;
  contentHash: string;
  rowCount: number;
  chunkCount: number;
  headers: string[];
};

type SnapshotChunkCommand = {
  version: 1;
  mode: "snapshot.chunk";
  spreadsheetId: string;
  sheetName: string;
  sessionId: string;
  chunkIndex: number;
  rows: ParsedMarketingActualRow[];
};

type SnapshotCommitCommand = {
  version: 1;
  mode: "snapshot.commit";
  spreadsheetId: string;
  sheetName: string;
  sessionId: string;
};

export type MarketingActualCommand =
  | PatchCommand
  | SnapshotOfferCommand
  | SnapshotChunkCommand
  | SnapshotCommitCommand;

export class MarketingActualWebhookError extends Error {
  constructor(
    message: string,
    public readonly status = 400,
  ) {
    super(message);
    this.name = "MarketingActualWebhookError";
  }
}

export function assertSnapshotRevision(
  baseRevision: number,
  currentRevision: number,
) {
  if (baseRevision !== currentRevision) {
    throw new MarketingActualWebhookError(
      "Снимок устарел: после его подготовки Atlas получил более свежие изменения.",
      409,
    );
  }
}

function asRecord(value: unknown, message: string): RecordValue {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new MarketingActualWebhookError(message);
  }
  return value as RecordValue;
}

function textField(record: RecordValue, key: string, label: string) {
  const value = String(record[key] ?? "").trim();
  if (!value) {
    throw new MarketingActualWebhookError(`${label} не задан.`);
  }
  return value;
}

function integerField(
  record: RecordValue,
  key: string,
  label: string,
  minimum: number,
  maximum: number,
) {
  const value = record[key];
  if (
    typeof value !== "number" ||
    !Number.isInteger(value) ||
    value < minimum ||
    value > maximum
  ) {
    throw new MarketingActualWebhookError(
      `${label} должен быть целым числом от ${minimum} до ${maximum}.`,
    );
  }
  return value;
}

function identity(record: RecordValue) {
  const spreadsheetId = textField(
    record,
    "spreadsheetId",
    "Идентификатор таблицы",
  );
  const sheetName = textField(record, "sheetName", "Название листа");
  if (
    spreadsheetId !== env.marketingActualSpreadsheetId ||
    sheetName !== env.marketingActualSheetName
  ) {
    throw new MarketingActualWebhookError(
      "Таблица или лист не входят в список разрешённых.",
      403,
    );
  }
  return { spreadsheetId, sheetName };
}

function parseAffectedRows(value: unknown) {
  if (!Array.isArray(value) || value.length > MAX_MARKETING_ACTUAL_ROWS) {
    throw new MarketingActualWebhookError(
      "Список затронутых строк задан неверно.",
    );
  }
  const rows = value.map((item) => {
    if (
      typeof item !== "number" ||
      !Number.isInteger(item) ||
      item < 2 ||
      item > MAX_MARKETING_ACTUAL_ROWS + 1
    ) {
      throw new MarketingActualWebhookError(
        "Номер затронутой строки должен быть целым числом от 2 до 10001.",
      );
    }
    return item;
  });
  if (new Set(rows).size !== rows.length) {
    throw new MarketingActualWebhookError(
      "Список затронутых строк содержит повторы.",
    );
  }
  return rows.sort((left, right) => left - right);
}

function wrapValidation<T>(callback: () => T) {
  try {
    return callback();
  } catch (error) {
    throw new MarketingActualWebhookError(
      error instanceof Error
        ? error.message
        : "Данные маркетингового факта не прошли проверку.",
    );
  }
}

export function parseMarketingActualCommand(rawBody: string) {
  let value: unknown;
  try {
    value = JSON.parse(rawBody);
  } catch {
    throw new MarketingActualWebhookError("Тело webhook не является корректным JSON.");
  }
  const record = asRecord(value, "Тело webhook имеет неверный формат.");
  if (record.version !== 1) {
    throw new MarketingActualWebhookError("Версия контракта webhook не поддерживается.");
  }

  const mode = textField(record, "mode", "Режим синхронизации");
  const source = identity(record);
  if (mode === "patch") {
    const affectedRows = parseAffectedRows(record.affectedRows);
    const rows = wrapValidation(() =>
      validateMarketingActualRows(record.rows),
    );
    const affected = new Set(affectedRows);
    if (rows.some((row) => !affected.has(row.sourceRow))) {
      throw new MarketingActualWebhookError(
        "Переданная строка отсутствует в списке затронутых строк.",
      );
    }
    return {
      version: 1,
      mode,
      ...source,
      affectedRows,
      rows,
    } satisfies PatchCommand;
  }

  if (mode === "snapshot.offer") {
    const snapshotId = textField(record, "snapshotId", "Идентификатор снимка");
    const contentHash = textField(record, "contentHash", "Хеш снимка");
    if (!IDENTIFIER_PATTERN.test(snapshotId)) {
      throw new MarketingActualWebhookError(
        "Идентификатор снимка имеет неверный формат.",
      );
    }
    if (!HASH_PATTERN.test(contentHash)) {
      throw new MarketingActualWebhookError("SHA-256 снимка имеет неверный формат.");
    }
    const rowCount = integerField(
      record,
      "rowCount",
      "Число строк снимка",
      0,
      MAX_MARKETING_ACTUAL_ROWS,
    );
    const expectedChunks = Math.ceil(
      rowCount / MAX_MARKETING_ACTUAL_CHUNK_ROWS,
    );
    const chunkCount = integerField(
      record,
      "chunkCount",
      "Число частей снимка",
      0,
      Math.ceil(MAX_MARKETING_ACTUAL_ROWS / MAX_MARKETING_ACTUAL_CHUNK_ROWS),
    );
    if (chunkCount !== expectedChunks) {
      throw new MarketingActualWebhookError(
        "Число частей снимка не соответствует числу строк.",
      );
    }
    const headers = wrapValidation(() =>
      validateMarketingActualHeaders(record.headers),
    );
    return {
      version: 1,
      mode,
      ...source,
      snapshotId,
      contentHash,
      rowCount,
      chunkCount,
      headers,
    } satisfies SnapshotOfferCommand;
  }

  if (mode === "snapshot.chunk") {
    const sessionId = textField(record, "sessionId", "Идентификатор сессии");
    const chunkIndex = integerField(
      record,
      "chunkIndex",
      "Номер части снимка",
      0,
      Math.ceil(MAX_MARKETING_ACTUAL_ROWS / MAX_MARKETING_ACTUAL_CHUNK_ROWS) - 1,
    );
    if (!Array.isArray(record.rows) || record.rows.length > MAX_MARKETING_ACTUAL_CHUNK_ROWS) {
      throw new MarketingActualWebhookError(
        "Одна часть снимка не может содержать более 500 строк.",
      );
    }
    const rows = wrapValidation(() =>
      validateMarketingActualRows(record.rows),
    );
    return {
      version: 1,
      mode,
      ...source,
      sessionId,
      chunkIndex,
      rows,
    } satisfies SnapshotChunkCommand;
  }

  if (mode === "snapshot.commit") {
    return {
      version: 1,
      mode,
      ...source,
      sessionId: textField(record, "sessionId", "Идентификатор сессии"),
    } satisfies SnapshotCommitCommand;
  }

  throw new MarketingActualWebhookError(
    "Режим синхронизации webhook не поддерживается.",
  );
}

function prismaMode(mode: MarketingActualCommand["mode"]) {
  switch (mode) {
    case "patch":
      return MarketingActualSyncMode.PATCH;
    case "snapshot.offer":
      return MarketingActualSyncMode.SNAPSHOT_OFFER;
    case "snapshot.chunk":
      return MarketingActualSyncMode.SNAPSHOT_CHUNK;
    case "snapshot.commit":
      return MarketingActualSyncMode.SNAPSHOT_COMMIT;
  }
}

async function acquireLock(transaction: Prisma.TransactionClient) {
  await transaction.$queryRaw<Array<{ acquired: string }>>(
    Prisma.sql`SELECT pg_advisory_xact_lock(${ADVISORY_LOCK_KEY})::text AS acquired`,
  );
}

async function ensureState(
  transaction: Prisma.TransactionClient,
  spreadsheetId: string,
  sheetName: string,
) {
  return transaction.marketingActualSyncState.upsert({
    where: { spreadsheetId_sheetName: { spreadsheetId, sheetName } },
    update: {},
    create: { spreadsheetId, sheetName },
  });
}

async function currentRows(
  transaction: Prisma.TransactionClient,
  spreadsheetId: string,
  sheetName: string,
) {
  const stored = await transaction.marketingActual.findMany({
    where: { spreadsheetId, sheetName },
    orderBy: { sourceRow: "asc" },
  });
  return stored.map((row) => {
    const direction = directionName(row.directionId);
    if (!direction) {
      throw new Error(`В базе найдено неизвестное направление «${row.directionId}».`);
    }
    const metrics = calculateMarketingMetrics([
      {
        visits: row.visits,
        leads: row.leads,
        budget: row.budget.toNumber(),
      },
    ]);
    return {
      sourceRow: row.sourceRow,
      date: row.date.toISOString().slice(0, 10),
      dateValue: row.date,
      directionId: row.directionId as ParsedMarketingActualRow["directionId"],
      direction,
      visits: row.visits,
      leads: row.leads,
      budget: row.budget.toNumber(),
      conversion: metrics.conversion,
      cpc: metrics.cpc,
      cpl: metrics.cpl,
      sourceUpdatedAt: row.sourceUpdatedAt,
    };
  });
}

function databaseRows(
  rows: ParsedMarketingActualRow[],
  spreadsheetId: string,
  sheetName: string,
  eventTime: Date,
) {
  return rows.map((row) => ({
    date: row.dateValue,
    directionId: row.directionId,
    visits: row.visits,
    leads: row.leads,
    budget: new Prisma.Decimal(row.budget.toFixed(2)),
    spreadsheetId,
    sheetName,
    sourceRow: row.sourceRow,
    sourceUpdatedAt: row.sourceUpdatedAt ?? eventTime,
  }));
}

function maxDate(rows: ParsedMarketingActualRow[]) {
  return rows.reduce<Date | null>(
    (latest, row) =>
      latest === null || row.dateValue > latest ? row.dateValue : latest,
    null,
  );
}

async function finishRun(
  transaction: Prisma.TransactionClient,
  runId: string,
  input: {
    status?: SyncStatus;
    changed: boolean;
    rowCount: number;
    contentHash?: string | null;
    message: string;
  },
) {
  await transaction.syncRun.update({
    where: { id: runId },
    data: {
      status: input.status ?? SyncStatus.SUCCESS,
      changed: input.changed,
      rowCount: input.rowCount,
      contentHash: input.contentHash,
      errorMessage:
        input.status === SyncStatus.SKIPPED ? input.message : null,
      finishedAt: new Date(),
    },
  });
}

async function applyPatch(
  command: PatchCommand,
  runId: string,
  eventTime: Date,
) {
  return prisma.$transaction(
    async (transaction) => {
      await acquireLock(transaction);
      const state = await ensureState(
        transaction,
        command.spreadsheetId,
        command.sheetName,
      );

      if (command.affectedRows.length === 0) {
        await finishRun(transaction, runId, {
          changed: false,
          rowCount: state.rowCount,
          contentHash: state.contentHash,
          message: "Подключение к Atlas подтверждено.",
        });
        return {
          message: "Подключение к Atlas подтверждено.",
          changed: false,
          revision: state.revision,
          rowCount: state.rowCount,
          contentHash: state.contentHash,
        };
      }

      await transaction.marketingActual.deleteMany({
        where: {
          spreadsheetId: command.spreadsheetId,
          sheetName: command.sheetName,
          sourceRow: { in: command.affectedRows },
        },
      });
      if (command.rows.length > 0) {
        await transaction.marketingActual.createMany({
          data: databaseRows(
            command.rows,
            command.spreadsheetId,
            command.sheetName,
            eventTime,
          ),
        });
      }

      const rows = await currentRows(
        transaction,
        command.spreadsheetId,
        command.sheetName,
      );
      const contentHash = hashMarketingActualRows(rows);
      const updatedState = await transaction.marketingActualSyncState.update({
        where: { id: state.id },
        data: {
          revision: { increment: 1 },
          contentHash,
          lastSuccessAt: new Date(),
          rowCount: rows.length,
          maxDate: maxDate(rows),
          lastError: null,
        },
      });
      await finishRun(transaction, runId, {
        changed: true,
        rowCount: rows.length,
        contentHash,
        message: "Изменения маркетингового факта применены.",
      });
      return {
        message: "Изменения маркетингового факта применены.",
        changed: true,
        revision: updatedState.revision,
        rowCount: rows.length,
        contentHash,
      };
    },
    { maxWait: 5_000, timeout: 30_000 },
  );
}

async function offerSnapshot(command: SnapshotOfferCommand, runId: string) {
  return prisma.$transaction(
    async (transaction) => {
      await acquireLock(transaction);
      const state = await ensureState(
        transaction,
        command.spreadsheetId,
        command.sheetName,
      );
      if (
        state.contentHash === command.contentHash &&
        state.rowCount === command.rowCount
      ) {
        await finishRun(transaction, runId, {
          status: SyncStatus.SKIPPED,
          changed: false,
          rowCount: state.rowCount,
          contentHash: state.contentHash,
          message: "Снимок уже соответствует данным Atlas.",
        });
        return {
          action: "skip" as const,
          message: "Снимок уже соответствует данным Atlas.",
          revision: state.revision,
          rowCount: state.rowCount,
          contentHash: state.contentHash,
        };
      }

      const existing =
        await transaction.marketingActualSnapshotSession.findUnique({
          where: { snapshotId: command.snapshotId },
        });
      if (
        existing &&
        (existing.stateId !== state.id ||
          existing.contentHash !== command.contentHash ||
          existing.rowCount !== command.rowCount ||
          existing.chunkCount !== command.chunkCount)
      ) {
        throw new MarketingActualWebhookError(
          "Идентификатор снимка уже использован с другими параметрами.",
          409,
        );
      }

      const expiresAt = new Date(Date.now() + SESSION_LIFETIME_MS);
      const session = existing
        ? await transaction.marketingActualSnapshotSession.update({
            where: { id: existing.id },
            data: {
              headers: command.headers,
              baseRevision: state.revision,
              status: MarketingActualSnapshotStatus.OFFERED,
              expiresAt,
              committedAt: null,
              chunks: { deleteMany: {} },
            },
          })
        : await transaction.marketingActualSnapshotSession.create({
            data: {
              snapshotId: command.snapshotId,
              stateId: state.id,
              contentHash: command.contentHash,
              rowCount: command.rowCount,
              chunkCount: command.chunkCount,
              headers: command.headers,
              baseRevision: state.revision,
              expiresAt,
            },
          });
      await finishRun(transaction, runId, {
        changed: false,
        rowCount: command.rowCount,
        contentHash: command.contentHash,
        message: "Atlas готов принять полный снимок.",
      });
      return {
        action: "upload" as const,
        message: "Atlas готов принять полный снимок.",
        sessionId: session.id,
        revision: state.revision,
      };
    },
    { maxWait: 5_000, timeout: 30_000 },
  );
}

async function storeSnapshotChunk(
  command: SnapshotChunkCommand,
  runId: string,
) {
  return prisma.$transaction(
    async (transaction) => {
      await acquireLock(transaction);
      const session =
        await transaction.marketingActualSnapshotSession.findUnique({
          where: { id: command.sessionId },
          include: { state: true },
        });
      if (
        !session ||
        session.state.spreadsheetId !== command.spreadsheetId ||
        session.state.sheetName !== command.sheetName
      ) {
        throw new MarketingActualWebhookError("Сессия снимка не найдена.", 404);
      }
      if (
        session.status !== MarketingActualSnapshotStatus.OFFERED ||
        session.expiresAt < new Date()
      ) {
        throw new MarketingActualWebhookError(
          "Сессия снимка завершена или устарела.",
          409,
        );
      }
      if (command.chunkIndex >= session.chunkCount) {
        throw new MarketingActualWebhookError(
          "Номер части выходит за границы снимка.",
        );
      }

      const payload = canonicalMarketingActualRows(command.rows);
      const existing = await transaction.marketingActualSnapshotChunk.findUnique({
        where: {
          sessionId_chunkIndex: {
            sessionId: session.id,
            chunkIndex: command.chunkIndex,
          },
        },
      });
      if (
        existing &&
        JSON.stringify(existing.payload) !== JSON.stringify(payload)
      ) {
        throw new MarketingActualWebhookError(
          "Эта часть снимка уже загружена с другим содержимым.",
          409,
        );
      }
      if (!existing) {
        await transaction.marketingActualSnapshotChunk.create({
          data: {
            sessionId: session.id,
            chunkIndex: command.chunkIndex,
            rowCount: command.rows.length,
            payload,
          },
        });
      }
      await finishRun(transaction, runId, {
        changed: false,
        rowCount: command.rows.length,
        contentHash: session.contentHash,
        message: "Часть снимка принята.",
      });
      return {
        message: "Часть снимка принята.",
        sessionId: session.id,
        chunkIndex: command.chunkIndex,
      };
    },
    { maxWait: 5_000, timeout: 30_000 },
  );
}

async function commitSnapshot(
  command: SnapshotCommitCommand,
  runId: string,
  eventTime: Date,
) {
  return prisma.$transaction(
    async (transaction) => {
      await acquireLock(transaction);
      const session =
        await transaction.marketingActualSnapshotSession.findUnique({
          where: { id: command.sessionId },
          include: {
            state: true,
            chunks: { orderBy: { chunkIndex: "asc" } },
          },
        });
      if (
        !session ||
        session.state.spreadsheetId !== command.spreadsheetId ||
        session.state.sheetName !== command.sheetName
      ) {
        throw new MarketingActualWebhookError("Сессия снимка не найдена.", 404);
      }
      if (
        session.status === MarketingActualSnapshotStatus.COMMITTED &&
        session.state.contentHash === session.contentHash
      ) {
        await finishRun(transaction, runId, {
          status: SyncStatus.SKIPPED,
          changed: false,
          rowCount: session.state.rowCount,
          contentHash: session.state.contentHash,
          message: "Снимок уже применён.",
        });
        return {
          message: "Снимок уже применён.",
          changed: false,
          revision: session.state.revision,
          rowCount: session.state.rowCount,
          contentHash: session.state.contentHash,
        };
      }
      if (
        session.status !== MarketingActualSnapshotStatus.OFFERED ||
        session.expiresAt < new Date()
      ) {
        throw new MarketingActualWebhookError(
          "Сессия снимка завершена или устарела.",
          409,
        );
      }
      assertSnapshotRevision(
        session.baseRevision,
        session.state.revision,
      );
      wrapValidation(() => validateMarketingActualHeaders(session.headers));
      if (
        session.chunks.length !== session.chunkCount ||
        session.chunks.some((chunk, index) => chunk.chunkIndex !== index)
      ) {
        throw new MarketingActualWebhookError(
          "Получены не все части полного снимка.",
          409,
        );
      }
      const rawRows = session.chunks.flatMap((chunk) => {
        if (!Array.isArray(chunk.payload)) {
          throw new MarketingActualWebhookError(
            "Часть снимка имеет неверный формат.",
          );
        }
        return chunk.payload;
      });
      if (rawRows.length !== session.rowCount) {
        throw new MarketingActualWebhookError(
          "Число строк в частях не совпадает с предложением снимка.",
          409,
        );
      }
      const rows = wrapValidation(() => validateMarketingActualRows(rawRows));
      const contentHash = hashMarketingActualRows(rows);
      if (contentHash !== session.contentHash) {
        throw new MarketingActualWebhookError(
          "Итоговый SHA-256 снимка не совпал.",
          409,
        );
      }

      await transaction.marketingActual.deleteMany({
        where: {
          spreadsheetId: command.spreadsheetId,
          sheetName: command.sheetName,
        },
      });
      if (rows.length > 0) {
        await transaction.marketingActual.createMany({
          data: databaseRows(
            rows,
            command.spreadsheetId,
            command.sheetName,
            eventTime,
          ),
        });
      }
      const completedAt = new Date();
      const state = await transaction.marketingActualSyncState.update({
        where: { id: session.stateId },
        data: {
          revision: { increment: 1 },
          contentHash,
          lastSuccessAt: completedAt,
          rowCount: rows.length,
          maxDate: maxDate(rows),
          lastError: null,
        },
      });
      await transaction.marketingActualSnapshotSession.update({
        where: { id: session.id },
        data: {
          status: MarketingActualSnapshotStatus.COMMITTED,
          committedAt: completedAt,
        },
      });
      await finishRun(transaction, runId, {
        changed: true,
        rowCount: rows.length,
        contentHash,
        message: "Полный снимок маркетингового факта применён.",
      });
      return {
        message: "Полный снимок маркетингового факта применён.",
        changed: true,
        revision: state.revision,
        rowCount: rows.length,
        contentHash,
      };
    },
    { maxWait: 5_000, timeout: 30_000 },
  );
}

async function source() {
  return prisma.dataSource.upsert({
    where: { key: "google-marketing-actual" },
    update: {
      enabled: true,
      syncIntervalMinutes: 1,
    },
    create: {
      key: "google-marketing-actual",
      name: "Маркетинговый факт Google Sheets",
      type: "APPS_SCRIPT_WEBHOOK",
      syncIntervalMinutes: 1,
    },
  });
}

async function duplicateResult(
  eventId: string,
  command?: MarketingActualCommand,
) {
  const existing = await prisma.syncRun.findUnique({
    where: { externalEventId: eventId },
  });
  if (!existing || existing.status === SyncStatus.FAILED) return null;
  if (
    command &&
    existing.syncMode &&
    existing.syncMode !== prismaMode(command.mode)
  ) {
    throw new MarketingActualWebhookError(
      "Идентификатор события уже использован для другого режима синхронизации.",
      409,
    );
  }
  if (existing.status === SyncStatus.RUNNING) {
    throw new MarketingActualWebhookError(
      "Событие ещё обрабатывается, повторите запрос.",
      503,
    );
  }

  const result = {
    duplicate: true,
    message: "Событие уже обработано.",
    status: existing.status,
    rowCount: existing.rowCount,
    contentHash: existing.contentHash,
  };
  if (!command || command.mode === "patch") return result;
  if (command.mode === "snapshot.chunk") {
    return {
      ...result,
      sessionId: command.sessionId,
      chunkIndex: command.chunkIndex,
    };
  }

  const state = await prisma.marketingActualSyncState.findUnique({
    where: {
      spreadsheetId_sheetName: {
        spreadsheetId: command.spreadsheetId,
        sheetName: command.sheetName,
      },
    },
  });
  if (command.mode === "snapshot.commit") {
    return {
      ...result,
      changed: false,
      revision: state?.revision ?? 0,
      rowCount: state?.rowCount ?? existing.rowCount,
      contentHash: state?.contentHash ?? existing.contentHash,
    };
  }

  const session =
    await prisma.marketingActualSnapshotSession.findUnique({
      where: { snapshotId: command.snapshotId },
    });
  if (
    existing.status === SyncStatus.SKIPPED ||
    (state?.contentHash === command.contentHash &&
      state.rowCount === command.rowCount)
  ) {
    return {
      ...result,
      action: "skip" as const,
      revision: state?.revision ?? 0,
      rowCount: state?.rowCount ?? command.rowCount,
      contentHash: state?.contentHash ?? command.contentHash,
    };
  }
  if (session) {
    return {
      ...result,
      action: "upload" as const,
      sessionId: session.id,
      revision: state?.revision ?? session.baseRevision,
    };
  }
  throw new MarketingActualWebhookError(
    "Не удалось восстановить состояние повторного предложения снимка.",
    409,
  );
}

export async function processMarketingActualCommand(
  command: MarketingActualCommand,
  eventId: string,
  eventTime: Date,
) {
  const duplicate = await duplicateResult(eventId, command);
  if (duplicate) return duplicate;

  const dataSource = await source();
  let run;
  const failedRun = await prisma.syncRun.findUnique({
    where: { externalEventId: eventId },
  });
  try {
    run = failedRun
      ? await prisma.syncRun.update({
          where: { id: failedRun.id },
          data: {
            status: SyncStatus.RUNNING,
            startedAt: new Date(),
            finishedAt: null,
            errorMessage: null,
          },
        })
      : await prisma.syncRun.create({
          data: {
            sourceId: dataSource.id,
            trigger: SyncTrigger.WEBHOOK,
            status: SyncStatus.RUNNING,
            externalEventId: eventId,
            syncMode: prismaMode(command.mode),
          },
        });
  } catch (error) {
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === "P2002"
    ) {
      return (
        (await duplicateResult(eventId, command)) ?? {
          duplicate: true,
          message: "Событие уже обрабатывается.",
        }
      );
    }
    throw error;
  }

  try {
    switch (command.mode) {
      case "patch":
        return await applyPatch(command, run.id, eventTime);
      case "snapshot.offer":
        return await offerSnapshot(command, run.id);
      case "snapshot.chunk":
        return await storeSnapshotChunk(command, run.id);
      case "snapshot.commit":
        return await commitSnapshot(command, run.id, eventTime);
    }
  } catch (error) {
    const message =
      error instanceof Error
        ? error.message.slice(0, 1_000)
        : "Неизвестная ошибка синхронизации маркетингового факта.";
    await prisma.syncRun.update({
      where: { id: run.id },
      data: {
        status: SyncStatus.FAILED,
        changed: false,
        finishedAt: new Date(),
        errorMessage: message,
      },
    });
    await prisma.marketingActualSyncState.upsert({
      where: {
        spreadsheetId_sheetName: {
          spreadsheetId: command.spreadsheetId,
          sheetName: command.sheetName,
        },
      },
      update: { lastError: message },
      create: {
        spreadsheetId: command.spreadsheetId,
        sheetName: command.sheetName,
        lastError: message,
      },
    });
    if (error instanceof MarketingActualWebhookError) throw error;
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === "P2002"
    ) {
      throw new MarketingActualWebhookError(
        "Дата и направление либо исходная строка уже заняты другой записью.",
        409,
      );
    }
    throw error;
  }
}

export async function getMarketingActualSyncMetadata() {
  const configured = Boolean(
    env.marketingActualWebhookSecret &&
      env.marketingActualSpreadsheetId &&
      env.marketingActualSheetName,
  );
  if (!configured) {
    return {
      configured: false,
      lastSuccessAt: null,
      rowCount: 0,
      maxDate: null,
      revision: 0,
      error: "Интеграция маркетингового факта ещё не настроена.",
    };
  }

  const [state, dataSource] = await Promise.all([
    prisma.marketingActualSyncState.findUnique({
      where: {
        spreadsheetId_sheetName: {
          spreadsheetId: env.marketingActualSpreadsheetId,
          sheetName: env.marketingActualSheetName,
        },
      },
    }),
    prisma.dataSource.findUnique({
      where: { key: "google-marketing-actual" },
      include: {
        syncRuns: {
          orderBy: { startedAt: "desc" },
          take: 1,
          select: { status: true, errorMessage: true },
        },
      },
    }),
  ]);
  const latestRun = dataSource?.syncRuns[0];
  return {
    configured: true,
    lastSuccessAt: state?.lastSuccessAt?.toISOString() ?? null,
    rowCount: state?.rowCount ?? 0,
    maxDate: state?.maxDate?.toISOString().slice(0, 10) ?? null,
    revision: state?.revision ?? 0,
    error:
      latestRun?.status === SyncStatus.FAILED
        ? latestRun.errorMessage
        : state?.lastError ?? null,
  };
}

export { MARKETING_ACTUAL_HEADERS };
