import { Prisma } from "@prisma/client";

import { env } from "@/lib/env";

export type FintabloGroup = "income" | "outcome" | "transfer";

export interface FintabloCategoryRecord {
  externalId: string;
  parentExternalId: string | null;
  name: string;
  group: FintabloGroup;
  type: string | null;
  pnlType: string | null;
  description: string | null;
  isBuiltIn: boolean;
  raw: Prisma.InputJsonValue;
}

export interface FintabloDirectionRecord {
  externalId: string;
  parentExternalId: string | null;
  name: string;
  description: string | null;
  archived: boolean;
  raw: Prisma.InputJsonValue;
}

export interface FintabloTransactionRecord {
  externalId: string;
  parentExternalId: string | null;
  categoryExternalId: string | null;
  directionExternalId: string | null;
  moneybagExternalId: string;
  moneybag2ExternalId: string | null;
  group: FintabloGroup;
  amount: Prisma.Decimal;
  amount2: Prisma.Decimal | null;
  description: string | null;
  date: Date;
  timestamp: bigint | null;
  isPlan: boolean;
  raw: Prisma.InputJsonValue;
}

export interface FintabloCashFlowSnapshot {
  categories: FintabloCategoryRecord[];
  directions: FintabloDirectionRecord[];
  transactions: FintabloTransactionRecord[];
  requestIds: string[];
  receivedAt: Date;
}

type FetchImplementation = typeof fetch;

interface FintabloClientOptions {
  apiKey?: string;
  baseUrl?: string;
  fetchImplementation?: FetchImplementation;
  timeoutMs?: number;
  maxRetries?: number;
  sleep?: (milliseconds: number) => Promise<void>;
}

type ApiItemsResponse = {
  items: unknown[];
  requestId: string | null;
};

const PAGE_SIZE = 1_000;
const MAX_TRANSACTION_PAGES = 10_000;
const GROUPS = new Set<FintabloGroup>(["income", "outcome", "transfer"]);

export class FintabloApiError extends Error {
  constructor(
    message: string,
    readonly status: number | null = null,
    readonly requestId: string | null = null,
  ) {
    super(
      requestId ? `${message} X-Request-Id: ${requestId}.` : message,
    );
    this.name = "FintabloApiError";
  }
}

function record(value: unknown, context: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new FintabloApiError(
      `FinTablo вернул некорректный объект: ${context}.`,
    );
  }
  return value as Record<string, unknown>;
}

function requiredString(value: unknown, context: string) {
  if (typeof value !== "string" || !value.trim()) {
    throw new FintabloApiError(
      `FinTablo вернул некорректное текстовое поле: ${context}.`,
    );
  }
  return value;
}

function optionalString(value: unknown, context: string) {
  if (value === null || value === undefined || value === "") return null;
  if (typeof value !== "string") {
    throw new FintabloApiError(
      `FinTablo вернул некорректное текстовое поле: ${context}.`,
    );
  }
  return value;
}

function externalId(value: unknown, context: string, required = true) {
  if (value === null || value === undefined || value === "") {
    if (!required) return null;
    throw new FintabloApiError(
      `FinTablo не вернул идентификатор: ${context}.`,
    );
  }
  if (
    (typeof value === "number" && Number.isSafeInteger(value)) ||
    (typeof value === "string" && /^-?\d+$/.test(value))
  ) {
    return String(value);
  }
  throw new FintabloApiError(
    `FinTablo вернул некорректный идентификатор: ${context}.`,
  );
}

function booleanFlag(value: unknown, context: string, fallback = false) {
  if (value === null || value === undefined || value === "") return fallback;
  if (value === true || value === 1 || value === "1") return true;
  if (value === false || value === 0 || value === "0") return false;
  throw new FintabloApiError(
    `FinTablo вернул некорректный флаг: ${context}.`,
  );
}

function group(value: unknown, context: string): FintabloGroup {
  if (typeof value === "string" && GROUPS.has(value as FintabloGroup)) {
    return value as FintabloGroup;
  }
  throw new FintabloApiError(
    `FinTablo вернул неизвестную группу операции: ${context}.`,
  );
}

export function parseFintabloDate(value: unknown, context = "date") {
  if (typeof value !== "string") {
    throw new FintabloApiError(
      `FinTablo вернул некорректную дату: ${context}.`,
    );
  }
  const match = /^(\d{2})\.(\d{2})\.(\d{4})$/.exec(value);
  if (!match) {
    throw new FintabloApiError(
      `FinTablo вернул дату не в формате ДД.ММ.ГГГГ: ${context}.`,
    );
  }
  const day = Number(match[1]);
  const month = Number(match[2]);
  const year = Number(match[3]);
  const result = new Date(Date.UTC(year, month - 1, day));
  if (
    result.getUTCFullYear() !== year ||
    result.getUTCMonth() !== month - 1 ||
    result.getUTCDate() !== day
  ) {
    throw new FintabloApiError(
      `FinTablo вернул несуществующую дату: ${context}.`,
    );
  }
  return result;
}

export function parseFintabloDecimal(value: unknown, context = "value") {
  if (
    (typeof value !== "number" && typeof value !== "string") ||
    (typeof value === "string" && !value.trim())
  ) {
    throw new FintabloApiError(
      `FinTablo вернул некорректную сумму: ${context}.`,
    );
  }
  try {
    const result = new Prisma.Decimal(value);
    if (!result.isFinite()) throw new Error("not finite");
    return result;
  } catch {
    throw new FintabloApiError(
      `FinTablo вернул некорректную сумму: ${context}.`,
    );
  }
}

function optionalTimestamp(value: unknown, context: string) {
  if (value === null || value === undefined || value === "") return null;
  if (
    (typeof value === "number" && Number.isSafeInteger(value)) ||
    (typeof value === "string" && /^-?\d+$/.test(value))
  ) {
    return BigInt(value);
  }
  throw new FintabloApiError(
    `FinTablo вернул некорректную временную метку: ${context}.`,
  );
}

function normalizeCategory(value: unknown, index: number): FintabloCategoryRecord {
  const item = record(value, `category[${index}]`);
  return {
    externalId: externalId(item.id, `category[${index}].id`)!,
    parentExternalId: externalId(
      item.parentId,
      `category[${index}].parentId`,
      false,
    ),
    name: requiredString(item.name, `category[${index}].name`),
    group: group(item.group, `category[${index}].group`),
    type: optionalString(item.type, `category[${index}].type`),
    pnlType: optionalString(item.pnlType, `category[${index}].pnlType`),
    description: optionalString(
      item.description,
      `category[${index}].description`,
    ),
    isBuiltIn: booleanFlag(
      item.isBuiltIn,
      `category[${index}].isBuiltIn`,
    ),
    raw: item as Prisma.InputJsonValue,
  };
}

function normalizeDirection(value: unknown, index: number): FintabloDirectionRecord {
  const item = record(value, `direction[${index}]`);
  return {
    externalId: externalId(item.id, `direction[${index}].id`)!,
    parentExternalId: externalId(
      item.parentId,
      `direction[${index}].parentId`,
      false,
    ),
    name: requiredString(item.name, `direction[${index}].name`),
    description: optionalString(
      item.description,
      `direction[${index}].description`,
    ),
    archived: booleanFlag(item.archived, `direction[${index}].archived`),
    raw: item as Prisma.InputJsonValue,
  };
}

function normalizeTransaction(
  value: unknown,
  index: number,
): FintabloTransactionRecord {
  const item = record(value, `transaction[${index}]`);
  return {
    externalId: externalId(item.id, `transaction[${index}].id`)!,
    parentExternalId: externalId(
      item.parentId,
      `transaction[${index}].parentId`,
      false,
    ),
    categoryExternalId: externalId(
      item.categoryId,
      `transaction[${index}].categoryId`,
      false,
    ),
    directionExternalId: externalId(
      item.directionId,
      `transaction[${index}].directionId`,
      false,
    ),
    moneybagExternalId: externalId(
      item.moneybagId,
      `transaction[${index}].moneybagId`,
    )!,
    moneybag2ExternalId: externalId(
      item.moneybag2Id,
      `transaction[${index}].moneybag2Id`,
      false,
    ),
    group: group(item.group, `transaction[${index}].group`),
    amount: parseFintabloDecimal(
      item.value,
      `transaction[${index}].value`,
    ),
    amount2:
      item.value2 === null || item.value2 === undefined
        ? null
        : parseFintabloDecimal(
            item.value2,
            `transaction[${index}].value2`,
          ),
    description: optionalString(
      item.description,
      `transaction[${index}].description`,
    ),
    date: parseFintabloDate(item.date, `transaction[${index}].date`),
    timestamp: optionalTimestamp(
      item.timestamp,
      `transaction[${index}].timestamp`,
    ),
    isPlan: booleanFlag(item.isPlan, `transaction[${index}].isPlan`),
    raw: item as Prisma.InputJsonValue,
  };
}

function ensureUnique(
  values: Array<{ externalId: string }>,
  entityName: string,
) {
  const ids = new Set<string>();
  for (const value of values) {
    if (ids.has(value.externalId)) {
      throw new FintabloApiError(
        `FinTablo вернул повторяющийся идентификатор ${entityName}: ${value.externalId}.`,
      );
    }
    ids.add(value.externalId);
  }
}

const defaultSleep = (milliseconds: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, milliseconds));

export class FintabloClient {
  private readonly apiKey: string;
  private readonly baseUrl: string;
  private readonly fetchImplementation: FetchImplementation;
  private readonly timeoutMs: number;
  private readonly maxRetries: number;
  private readonly sleep: (milliseconds: number) => Promise<void>;

  constructor(options: FintabloClientOptions = {}) {
    this.apiKey = options.apiKey ?? env.fintabloApiKey;
    this.baseUrl = (options.baseUrl ?? env.fintabloApiBaseUrl).replace(
      /\/+$/,
      "",
    );
    this.fetchImplementation = options.fetchImplementation ?? fetch;
    this.timeoutMs = options.timeoutMs ?? 20_000;
    this.maxRetries = options.maxRetries ?? 2;
    this.sleep = options.sleep ?? defaultSleep;
  }

  private async requestItems(path: string): Promise<ApiItemsResponse> {
    if (!this.apiKey) {
      throw new FintabloApiError(
        "Ключ FinTablo не настроен. Укажите FINTABLO_API_KEY.",
      );
    }

    for (let attempt = 0; attempt <= this.maxRetries; attempt += 1) {
      const controller = new AbortController();
      let timedOut = false;
      const timeout = setTimeout(() => {
        timedOut = true;
        controller.abort();
      }, this.timeoutMs);

      try {
        const response = await this.fetchImplementation(
          `${this.baseUrl}${path}`,
          {
            method: "GET",
            headers: {
              Accept: "application/json",
              Authorization: `Bearer ${this.apiKey}`,
            },
            cache: "no-store",
            signal: controller.signal,
          },
        );
        const requestId = response.headers.get("x-request-id");
        const retryable =
          response.status === 429 || response.status >= 500;
        if (retryable && attempt < this.maxRetries) {
          const retryAfterHeader = response.headers.get("retry-after");
          const retryAfter = retryAfterHeader
            ? Number(retryAfterHeader)
            : Number.NaN;
          const delay = Number.isFinite(retryAfter)
            ? Math.min(Math.max(retryAfter * 1_000, 0), 5_000)
            : 250 * 2 ** attempt;
          await response.body?.cancel().catch(() => undefined);
          await this.sleep(delay);
          continue;
        }
        if (!response.ok) {
          const messages: Record<number, string> = {
            401: "FinTablo отклонил ключ доступа",
            429: "FinTablo временно ограничил число запросов",
          };
          throw new FintabloApiError(
            messages[response.status] ??
              `FinTablo вернул HTTP ${response.status}`,
            response.status,
            requestId,
          );
        }

        let payload: unknown;
        try {
          payload = await response.json();
        } catch {
          throw new FintabloApiError(
            "FinTablo вернул ответ не в формате JSON.",
            response.status,
            requestId,
          );
        }
        const body = record(payload, path);
        if (body.status !== 200 || !Array.isArray(body.items)) {
          throw new FintabloApiError(
            "FinTablo вернул некорректную структуру ответа.",
            response.status,
            requestId,
          );
        }
        return { items: body.items, requestId };
      } catch (error) {
        if (timedOut) {
          throw new FintabloApiError(
            `FinTablo не ответил за ${Math.round(this.timeoutMs / 1_000)} сек.`,
          );
        }
        if (error instanceof FintabloApiError) throw error;
        throw new FintabloApiError(
          error instanceof Error
            ? `Не удалось выполнить запрос к FinTablo: ${error.message}`
            : "Не удалось выполнить запрос к FinTablo.",
        );
      } finally {
        clearTimeout(timeout);
      }
    }

    throw new FintabloApiError("Не удалось выполнить запрос к FinTablo.");
  }

  async loadCashFlowSnapshot(): Promise<FintabloCashFlowSnapshot> {
    const requestIds: string[] = [];
    const categoriesResponse = await this.requestItems("/v1/category");
    if (categoriesResponse.requestId) {
      requestIds.push(categoriesResponse.requestId);
    }
    const directionsResponse = await this.requestItems("/v1/direction");
    if (directionsResponse.requestId) {
      requestIds.push(directionsResponse.requestId);
    }

    const transactionItems: unknown[] = [];
    let completed = false;
    for (let page = 1; page <= MAX_TRANSACTION_PAGES; page += 1) {
      const response = await this.requestItems(
        `/v1/transaction?isPlan=0&pageSize=${PAGE_SIZE}&page=${page}`,
      );
      if (response.requestId) requestIds.push(response.requestId);
      transactionItems.push(...response.items);
      if (response.items.length < PAGE_SIZE) {
        completed = true;
        break;
      }
    }
    if (!completed) {
      throw new FintabloApiError(
        "FinTablo вернул слишком много страниц операций.",
      );
    }

    const categories = categoriesResponse.items.map(normalizeCategory);
    const directions = directionsResponse.items.map(normalizeDirection);
    const transactions = transactionItems
      .map(normalizeTransaction)
      .filter((item) => !item.isPlan);
    ensureUnique(categories, "статьи");
    ensureUnique(directions, "направления");
    ensureUnique(transactions, "операции");

    return {
      categories,
      directions,
      transactions,
      requestIds,
      receivedAt: new Date(),
    };
  }
}

export function loadFintabloCashFlow() {
  return new FintabloClient().loadCashFlowSnapshot();
}
