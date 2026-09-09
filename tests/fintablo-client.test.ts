import { describe, expect, it, vi } from "vitest";

import {
  FintabloClient,
  parseFintabloDate,
  parseFintabloDecimal,
} from "@/services/fintablo-client";

function apiResponse(
  items: unknown[],
  httpStatus = 200,
  requestId?: string,
) {
  return new Response(JSON.stringify({ status: httpStatus, items }), {
    status: httpStatus,
    headers: requestId ? { "X-Request-Id": requestId } : undefined,
  });
}

const category = {
  id: 10,
  name: "Продажи",
  group: "income",
  parentId: null,
  isBuiltIn: 0,
};

const direction = {
  id: 20,
  name: "Брендинг",
  parentId: null,
  archived: 0,
};

function transaction(id: number) {
  return {
    id,
    value: id === 1 ? "123.45" : 1,
    moneybagId: 30,
    group: "income",
    parentId: null,
    date: "07.08.2026",
    timestamp: 1_786_060_800,
    isPlan: 0,
    categoryId: 10,
    directionId: 20,
    customField: "сохранить",
  };
}

function queuedFetch(responses: Response[]) {
  return vi.fn(
    async (...args: [string | URL | Request, RequestInit?]) => {
      void args;
      const next = responses.shift();
      if (!next) throw new Error("Неожиданный запрос");
      return next;
    },
  );
}

describe("парсинг FinTablo", () => {
  it("преобразует даты и точные суммы", () => {
    expect(parseFintabloDate("07.08.2026").toISOString()).toBe(
      "2026-08-07T00:00:00.000Z",
    );
    expect(parseFintabloDecimal("123.45").toFixed(2)).toBe("123.45");
  });

  it("отклоняет некорректные даты и суммы", () => {
    expect(() => parseFintabloDate("31.02.2026")).toThrow(
      "несуществующую дату",
    );
    expect(() => parseFintabloDecimal("не сумма")).toThrow(
      "некорректную сумму",
    );
  });
});

describe("FintabloClient", () => {
  it("передаёт Bearer-заголовок и читает страницы до неполной", async () => {
    const firstPage = Array.from({ length: 1_000 }, (_, index) =>
      transaction(index + 1),
    );
    const request = queuedFetch([
      apiResponse([category]),
      apiResponse([direction]),
      apiResponse(firstPage),
      apiResponse([transaction(1_001)]),
    ]);
    const client = new FintabloClient({
      apiKey: "secret-key",
      baseUrl: "https://example.test",
      fetchImplementation: request as unknown as typeof fetch,
    });

    const snapshot = await client.loadCashFlowSnapshot();

    expect(request).toHaveBeenCalledTimes(4);
    expect(String(request.mock.calls[2][0])).toContain(
      "/v1/transaction?isPlan=0&pageSize=1000&page=1",
    );
    expect(String(request.mock.calls[3][0])).toContain("page=2");
    for (const call of request.mock.calls) {
      expect(new Headers(call[1]?.headers).get("authorization")).toBe(
        "Bearer secret-key",
      );
    }
    expect(snapshot.transactions).toHaveLength(1_001);
    expect(snapshot.transactions[0].amount.toFixed(2)).toBe("123.45");
    expect(snapshot.transactions[0].date.toISOString()).toBe(
      "2026-08-07T00:00:00.000Z",
    );
    expect(snapshot.transactions[0].raw).toMatchObject({
      customField: "сохранить",
    });
  });

  it("повторяет 429 и 5xx, затем продолжает загрузку", async () => {
    const request = queuedFetch([
      apiResponse([], 429, "rate-1"),
      apiResponse([], 503, "server-1"),
      apiResponse([category]),
      apiResponse([direction]),
      apiResponse([]),
    ]);
    const sleep = vi.fn(async () => undefined);
    const client = new FintabloClient({
      apiKey: "secret-key",
      fetchImplementation: request as unknown as typeof fetch,
      maxRetries: 2,
      sleep,
    });

    await expect(client.loadCashFlowSnapshot()).resolves.toMatchObject({
      transactions: [],
    });
    expect(sleep).toHaveBeenCalledTimes(2);
    expect(sleep).toHaveBeenNthCalledWith(1, 250);
    expect(sleep).toHaveBeenNthCalledWith(2, 500);
  });

  it("не повторяет 401 и сохраняет диагностический X-Request-Id", async () => {
    const request = queuedFetch([apiResponse([], 401, "auth-42")]);
    const client = new FintabloClient({
      apiKey: "bad-key",
      fetchImplementation: request as unknown as typeof fetch,
    });

    await expect(client.loadCashFlowSnapshot()).rejects.toMatchObject({
      status: 401,
      requestId: "auth-42",
      message: expect.stringContaining("auth-42"),
    });
    expect(request).toHaveBeenCalledOnce();
  });

  it("прерывает зависший запрос по таймауту", async () => {
    const request = vi.fn(
      (_input: string | URL | Request, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener(
            "abort",
            () => reject(new DOMException("Aborted", "AbortError")),
            { once: true },
          );
        }),
    );
    const client = new FintabloClient({
      apiKey: "secret-key",
      fetchImplementation: request as unknown as typeof fetch,
      timeoutMs: 5,
    });

    await expect(client.loadCashFlowSnapshot()).rejects.toThrow(
      "не ответил",
    );
  });

  it("отклоняет некорректную структуру ответа", async () => {
    const request = vi.fn(async () =>
      new Response(JSON.stringify({ status: 200, items: {} })),
    );
    const client = new FintabloClient({
      apiKey: "secret-key",
      fetchImplementation: request as unknown as typeof fetch,
    });

    await expect(client.loadCashFlowSnapshot()).rejects.toThrow(
      "некорректную структуру ответа",
    );
  });
});

describe("ошибки FintabloClient", () => {
  it("не повторяет 401 и сохраняет диагностический X-Request-Id", async () => {
    const request = queuedFetch([apiResponse([], 401, "request-401")]);
    const client = new FintabloClient({
      apiKey: "wrong-key",
      fetchImplementation: request as unknown as typeof fetch,
    });

    await expect(client.loadCashFlowSnapshot()).rejects.toThrow(
      "FinTablo отклонил ключ доступа X-Request-Id: request-401",
    );
    expect(request).toHaveBeenCalledOnce();
  });

  it("повторяет 429 и продолжает после успешного ответа", async () => {
    const request = queuedFetch([
      new Response(JSON.stringify({ status: 429 }), {
        status: 429,
        headers: { "Retry-After": "0" },
      }),
      apiResponse([category]),
      apiResponse([direction]),
      apiResponse([transaction(1)]),
    ]);
    const sleep = vi.fn(async () => undefined);
    const client = new FintabloClient({
      apiKey: "secret-key",
      fetchImplementation: request as unknown as typeof fetch,
      sleep,
    });

    const snapshot = await client.loadCashFlowSnapshot();

    expect(snapshot.transactions).toHaveLength(1);
    expect(sleep).toHaveBeenCalledOnce();
    expect(request).toHaveBeenCalledTimes(4);
  });

  it("ограничивает число повторов для 5xx", async () => {
    const request = queuedFetch([
      apiResponse([], 503, "request-503-a"),
      apiResponse([], 503, "request-503-b"),
    ]);
    const client = new FintabloClient({
      apiKey: "secret-key",
      fetchImplementation: request as unknown as typeof fetch,
      maxRetries: 1,
      sleep: async () => undefined,
    });

    await expect(client.loadCashFlowSnapshot()).rejects.toThrow(
      "HTTP 503 X-Request-Id: request-503-b",
    );
    expect(request).toHaveBeenCalledTimes(2);
  });

  it("прерывает зависший запрос по таймауту", async () => {
    const request = vi.fn(
      (_input: string | URL | Request, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener(
            "abort",
            () => reject(new DOMException("Прервано", "AbortError")),
            { once: true },
          );
        }),
    );
    const client = new FintabloClient({
      apiKey: "secret-key",
      fetchImplementation: request as unknown as typeof fetch,
      timeoutMs: 5,
    });

    await expect(client.loadCashFlowSnapshot()).rejects.toThrow(
      "FinTablo не ответил",
    );
  });
});
