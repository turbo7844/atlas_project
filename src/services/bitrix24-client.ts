import { Prisma } from "@prisma/client";

type FetchImplementation = typeof fetch;

type Bitrix24ClientOptions = {
  webhookUrl: string;
  fetchImplementation?: FetchImplementation;
  timeoutMs?: number;
};

type Bitrix24Response = {
  result?: unknown;
  total?: unknown;
  next?: unknown;
  error?: unknown;
  error_description?: unknown;
};

export type Bitrix24Connection = {
  portal: string;
  user: {
    id: string;
    name: string;
  };
  funnelCount: number;
  dealCount: number;
};

export type Bitrix24StageSemantics = "process" | "success" | "failure";

export type Bitrix24Funnel = {
  id: number;
  name: string;
  isDefault: boolean;
  stages: Array<{
    id: string;
    name: string;
    sort: number;
    semantics: Bitrix24StageSemantics;
  }>;
};

export type Bitrix24Deal = {
  id: string;
  categoryId: number;
  stageId: string;
  opportunity: Prisma.Decimal;
  currencyId: string;
  createdDate: string;
  closedDate: string | null;
};

export type Bitrix24SalesSnapshot = {
  funnels: Bitrix24Funnel[];
  deals: Bitrix24Deal[];
  receivedAt: Date;
};

const WEBHOOK_TOKEN_PATTERN = /^[a-zA-Z0-9_-]{8,}$/;

export class Bitrix24ApiError extends Error {
  constructor(
    message: string,
    readonly status: number | null = null,
    readonly code: string | null = null,
  ) {
    super(message);
    this.name = "Bitrix24ApiError";
  }
}

function isBitrix24CloudHost(hostname: string) {
  const labels = hostname.toLowerCase().split(".");
  const bitrixIndex = labels.lastIndexOf("bitrix24");
  if (bitrixIndex < 1) return false;

  const suffix = labels.slice(bitrixIndex + 1);
  return (
    (suffix.length === 1 && /^[a-z]{2,4}$/.test(suffix[0])) ||
    (suffix.length === 2 &&
      (suffix[0] === "com" || suffix[0] === "co") &&
      /^[a-z]{2}$/.test(suffix[1]))
  );
}

export function normalizeBitrix24WebhookUrl(value: string) {
  const rawValue = value.trim();
  if (!rawValue) {
    throw new Bitrix24ApiError(
      "Вебхук Bitrix24 не настроен. Укажите URL вебхука.",
      400,
    );
  }

  let url: URL;
  try {
    url = new URL(rawValue);
  } catch {
    throw new Bitrix24ApiError(
      "Укажите корректный URL входящего вебхука Bitrix24.",
      400,
    );
  }

  if (url.protocol !== "https:") {
    throw new Bitrix24ApiError(
      "Вебхук Bitrix24 должен использовать защищённый протокол HTTPS.",
      400,
    );
  }
  if (
    url.username ||
    url.password ||
    url.port ||
    url.search ||
    url.hash
  ) {
    throw new Bitrix24ApiError(
      "URL вебхука не должен содержать порт, параметры, логин или фрагмент.",
      400,
    );
  }
  if (!isBitrix24CloudHost(url.hostname)) {
    throw new Bitrix24ApiError(
      "Поддерживается облачный портал на домене Bitrix24. Для коробочной версии потребуется отдельный список разрешённых адресов.",
      400,
    );
  }

  const segments = url.pathname.split("/").filter(Boolean);
  if (
    segments.length !== 3 ||
    segments[0].toLowerCase() !== "rest" ||
    !/^\d+$/.test(segments[1]) ||
    !WEBHOOK_TOKEN_PATTERN.test(segments[2])
  ) {
    throw new Bitrix24ApiError(
      "Ожидается базовый URL вида https://портал.bitrix24.ru/rest/ID/СЕКРЕТ/ без имени REST-метода.",
      400,
    );
  }

  url.pathname = `/${segments.join("/")}/`;
  return url.toString();
}

function objectValue(value: unknown, context: string) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Bitrix24ApiError(
      `Bitrix24 вернул некорректный ответ: ${context}.`,
      502,
    );
  }
  return value as Record<string, unknown>;
}

function requiredString(value: unknown, context: string) {
  if (typeof value !== "string" || !value.trim()) {
    throw new Bitrix24ApiError(
      `Bitrix24 вернул некорректное поле ${context}.`,
      502,
    );
  }
  return value;
}

function integerId(value: unknown, context: string) {
  const result = Number(value);
  if (!Number.isSafeInteger(result) || result < 0) {
    throw new Bitrix24ApiError(
      `Bitrix24 вернул некорректный идентификатор ${context}.`,
      502,
    );
  }
  return result;
}

function externalId(value: unknown, context: string) {
  if (
    (typeof value !== "string" && typeof value !== "number") ||
    !/^\d+$/.test(String(value))
  ) {
    throw new Bitrix24ApiError(
      `Bitrix24 вернул некорректный идентификатор ${context}.`,
      502,
    );
  }
  return String(value);
}

function dateOnly(value: unknown, context: string, required: true): string;
function dateOnly(
  value: unknown,
  context: string,
  required: false,
): string | null;
function dateOnly(value: unknown, context: string, required: boolean) {
  if ((value === null || value === undefined || value === "") && !required) {
    return null;
  }
  if (typeof value !== "string") {
    throw new Bitrix24ApiError(
      `Bitrix24 вернул некорректную дату ${context}.`,
      502,
    );
  }
  const result = value.slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(result)) {
    throw new Bitrix24ApiError(
      `Bitrix24 вернул некорректную дату ${context}.`,
      502,
    );
  }
  const parsed = new Date(`${result}T00:00:00.000Z`);
  if (Number.isNaN(parsed.valueOf()) || parsed.toISOString().slice(0, 10) !== result) {
    throw new Bitrix24ApiError(
      `Bitrix24 вернул несуществующую дату ${context}.`,
      502,
    );
  }
  return result;
}

function decimal(value: unknown, context: string) {
  if (
    (typeof value !== "string" && typeof value !== "number") ||
    value === ""
  ) {
    throw new Bitrix24ApiError(
      `Bitrix24 вернул некорректную сумму ${context}.`,
      502,
    );
  }
  try {
    const result = new Prisma.Decimal(value);
    if (!result.isFinite()) throw new Error("not finite");
    return result;
  } catch {
    throw new Bitrix24ApiError(
      `Bitrix24 вернул некорректную сумму ${context}.`,
      502,
    );
  }
}

function stageSemantics(
  value: unknown,
  context: string,
): Bitrix24StageSemantics {
  if (value === "process" || value === "success" || value === "failure") {
    return value;
  }
  throw new Bitrix24ApiError(
    `Bitrix24 вернул неизвестную семантику стадии ${context}.`,
    502,
  );
}

function bitrixErrorMessage(code: string, description: string) {
  const messages: Record<string, string> = {
    INVALID_CREDENTIALS:
      "Bitrix24 отклонил вебхук. Проверьте идентификатор пользователя и секретный код.",
    NO_AUTH_FOUND:
      "Bitrix24 не получил данные авторизации. Проверьте URL вебхука.",
    insufficient_scope:
      "Вебхуку Bitrix24 не хватает права «CRM». Добавьте это право в настройках вебхука.",
    ACCESS_DENIED:
      "Bitrix24 запретил доступ. Проверьте права вебхука и доступность REST API на вашем тарифе.",
    QUERY_LIMIT_EXCEEDED:
      "Bitrix24 временно ограничил число REST-запросов. Повторите проверку позже.",
    OPERATION_TIME_LIMIT:
      "Bitrix24 временно ограничил выполнение REST-метода. Повторите проверку позже.",
  };
  if (messages[code]) return messages[code];

  const safeDescription = description.replace(/[\r\n]+/g, " ").slice(0, 240);
  return safeDescription
    ? `Bitrix24 вернул ошибку: ${safeDescription}`
    : `Bitrix24 вернул ошибку ${code || "REST API"}.`;
}

export class Bitrix24Client {
  private readonly webhookUrl: string;
  private readonly fetchImplementation: FetchImplementation;
  private readonly timeoutMs: number;

  constructor(options: Bitrix24ClientOptions) {
    this.webhookUrl = normalizeBitrix24WebhookUrl(options.webhookUrl);
    this.fetchImplementation = options.fetchImplementation ?? fetch;
    this.timeoutMs = options.timeoutMs ?? 12_000;
  }

  private async call(method: string, params: Record<string, unknown> = {}) {
    const controller = new AbortController();
    let timedOut = false;
    const timeout = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, this.timeoutMs);

    try {
      const response = await this.fetchImplementation(
        `${this.webhookUrl}${method}`,
        {
          method: "POST",
          headers: {
            Accept: "application/json",
            "Content-Type": "application/json",
          },
          body: JSON.stringify(params),
          cache: "no-store",
          redirect: "error",
          signal: controller.signal,
        },
      );

      let payload: Bitrix24Response;
      try {
        payload = objectValue(
          await response.json(),
          method,
        ) as Bitrix24Response;
      } catch (error) {
        if (error instanceof Bitrix24ApiError) throw error;
        throw new Bitrix24ApiError(
          "Bitrix24 вернул ответ не в формате JSON.",
          response.status,
        );
      }

      const code = typeof payload.error === "string" ? payload.error : "";
      const description =
        typeof payload.error_description === "string"
          ? payload.error_description
          : "";
      if (!response.ok || code) {
        throw new Bitrix24ApiError(
          bitrixErrorMessage(code, description),
          response.status,
          code || null,
        );
      }
      if (!("result" in payload)) {
        throw new Bitrix24ApiError(
          "Bitrix24 не вернул результат REST-метода.",
          response.status,
        );
      }
      return payload;
    } catch (error) {
      if (timedOut) {
        throw new Bitrix24ApiError(
          `Bitrix24 не ответил за ${Math.round(this.timeoutMs / 1_000)} сек.`,
          504,
        );
      }
      if (error instanceof Bitrix24ApiError) throw error;
      throw new Bitrix24ApiError(
        "Не удалось подключиться к Bitrix24. Проверьте адрес портала и доступ сервера к интернету.",
        502,
      );
    } finally {
      clearTimeout(timeout);
    }
  }

  async checkConnection(): Promise<Bitrix24Connection> {
    const profileResponse = await this.call("profile");
    const profile = objectValue(profileResponse.result, "profile.result");
    const userId = profile.ID;
    if (
      (typeof userId !== "string" && typeof userId !== "number") ||
      !String(userId)
    ) {
      throw new Bitrix24ApiError(
        "Bitrix24 не вернул идентификатор пользователя вебхука.",
        502,
      );
    }

    const categoriesResponse = await this.call("crm.category.list", {
      entityTypeId: 2,
    });
    const categoryResult = objectValue(
      categoriesResponse.result,
      "crm.category.list.result",
    );
    if (!Array.isArray(categoryResult.categories)) {
      throw new Bitrix24ApiError(
        "Bitrix24 не вернул список воронок сделок.",
        502,
      );
    }

    const dealsResponse = await this.call("crm.deal.list", {
      order: { ID: "ASC" },
      filter: {},
      select: ["ID"],
      start: 0,
    });
    if (!Array.isArray(dealsResponse.result)) {
      throw new Bitrix24ApiError(
        "Bitrix24 не вернул список сделок.",
        502,
      );
    }

    const total = Number(dealsResponse.total);
    const firstName = typeof profile.NAME === "string" ? profile.NAME : "";
    const lastName =
      typeof profile.LAST_NAME === "string" ? profile.LAST_NAME : "";

    return {
      portal: new URL(this.webhookUrl).hostname,
      user: {
        id: String(userId),
        name: `${firstName} ${lastName}`.trim() || `Пользователь ${userId}`,
      },
      funnelCount: categoryResult.categories.length,
      dealCount: Number.isSafeInteger(total)
        ? total
        : dealsResponse.result.length,
    };
  }

  async loadSalesSnapshot(): Promise<Bitrix24SalesSnapshot> {
    const categoryResponse = await this.call("crm.category.list", {
      entityTypeId: 2,
    });
    const categoryResult = objectValue(
      categoryResponse.result,
      "crm.category.list.result",
    );
    if (!Array.isArray(categoryResult.categories)) {
      throw new Bitrix24ApiError(
        "Bitrix24 не вернул список воронок сделок.",
        502,
      );
    }

    const funnels: Bitrix24Funnel[] = [];
    for (const [categoryIndex, rawCategory] of categoryResult.categories.entries()) {
      const category = objectValue(
        rawCategory,
        `crm.category.list.categories[${categoryIndex}]`,
      );
      const id = integerId(category.id, `воронки[${categoryIndex}].id`);
      const statusResponse = await this.call("crm.status.list", {
        order: { SORT: "ASC" },
        filter: { ENTITY_ID: id === 0 ? "DEAL_STAGE" : `DEAL_STAGE_${id}` },
      });
      if (!Array.isArray(statusResponse.result)) {
        throw new Bitrix24ApiError(
          `Bitrix24 не вернул стадии воронки ${id}.`,
          502,
        );
      }
      const stages = statusResponse.result.map((rawStage, stageIndex) => {
        const stage = objectValue(rawStage, `воронки[${id}].стадии[${stageIndex}]`);
        const extra = objectValue(
          stage.EXTRA,
          `воронки[${id}].стадии[${stageIndex}].EXTRA`,
        );
        return {
          id: requiredString(stage.STATUS_ID, `стадии[${stageIndex}].STATUS_ID`),
          name: requiredString(stage.NAME, `стадии[${stageIndex}].NAME`),
          sort: integerId(stage.SORT, `стадии[${stageIndex}].SORT`),
          semantics: stageSemantics(
            extra.SEMANTICS,
            `стадии[${stageIndex}].EXTRA.SEMANTICS`,
          ),
        };
      });
      funnels.push({
        id,
        name: requiredString(category.name, `воронки[${categoryIndex}].name`),
        isDefault: category.isDefault === "Y" || category.isDefault === true,
        stages,
      });
    }

    const deals: Bitrix24Deal[] = [];
    const categoryIds = funnels.map((funnel) => funnel.id);
    let start: number | null = 0;
    for (let page = 0; start !== null && page < 10_000; page += 1) {
      const dealResponse = await this.call("crm.deal.list", {
        order: { ID: "ASC" },
        filter: { "@CATEGORY_ID": categoryIds },
        select: [
          "ID",
          "CATEGORY_ID",
          "STAGE_ID",
          "OPPORTUNITY",
          "CURRENCY_ID",
          "DATE_CREATE",
          "CLOSEDATE",
        ],
        start,
      });
      if (!Array.isArray(dealResponse.result)) {
        throw new Bitrix24ApiError(
          "Bitrix24 не вернул список сделок.",
          502,
        );
      }
      const pageOffset = deals.length;
      for (const [dealIndex, rawDeal] of dealResponse.result.entries()) {
        const itemIndex = pageOffset + dealIndex;
        const deal = objectValue(rawDeal, `сделки[${itemIndex}]`);
        deals.push({
          id: externalId(deal.ID, `сделки[${itemIndex}].ID`),
          categoryId: integerId(
            deal.CATEGORY_ID,
            `сделки[${itemIndex}].CATEGORY_ID`,
          ),
          stageId: requiredString(
            deal.STAGE_ID,
            `сделки[${itemIndex}].STAGE_ID`,
          ),
          opportunity: decimal(
            deal.OPPORTUNITY,
            `сделки[${itemIndex}].OPPORTUNITY`,
          ),
          currencyId: requiredString(
            deal.CURRENCY_ID,
            `сделки[${itemIndex}].CURRENCY_ID`,
          ),
          createdDate: dateOnly(
            deal.DATE_CREATE,
            `сделки[${itemIndex}].DATE_CREATE`,
            true,
          ),
          closedDate: dateOnly(
            deal.CLOSEDATE,
            `сделки[${itemIndex}].CLOSEDATE`,
            false,
          ),
        });
      }

      if (dealResponse.next === undefined || dealResponse.next === null) {
        start = null;
      } else {
        const next = Number(dealResponse.next);
        if (!Number.isSafeInteger(next) || next <= start) {
          throw new Bitrix24ApiError(
            "Bitrix24 вернул некорректный указатель следующей страницы сделок.",
            502,
          );
        }
        start = next;
      }
    }
    if (start !== null) {
      throw new Bitrix24ApiError(
        "Bitrix24 вернул слишком много страниц сделок.",
        502,
      );
    }
    if (new Set(deals.map((deal) => deal.id)).size !== deals.length) {
      throw new Bitrix24ApiError(
        "Bitrix24 вернул повторяющиеся идентификаторы сделок.",
        502,
      );
    }

    return { funnels, deals, receivedAt: new Date() };
  }
}

export function loadBitrix24Sales() {
  return new Bitrix24Client({
    webhookUrl: process.env.BITRIX24_WEBHOOK_URL ?? "",
  }).loadSalesSnapshot();
}
