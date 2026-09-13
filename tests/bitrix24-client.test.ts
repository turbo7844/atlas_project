import { describe, expect, it, vi } from "vitest";

import {
  Bitrix24Client,
  normalizeBitrix24WebhookUrl,
} from "@/services/bitrix24-client";

const webhookUrl =
  "https://atlas-test.bitrix24.ru/rest/7/abcDEF_123456/";

function jsonResponse(payload: unknown, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function successfulFetch() {
  return vi.fn(
    async (input: string | URL | Request, _init?: RequestInit) => {
      void _init;
      const url = String(input);
      if (url.endsWith("/profile")) {
        return jsonResponse({
          result: { ID: "7", NAME: "Анна", LAST_NAME: "Орлова" },
        });
      }
      if (url.endsWith("/crm.category.list")) {
        return jsonResponse({
          result: {
            categories: [
              { id: 0, name: "Общая" },
              { id: 9, name: "Брендинг" },
            ],
          },
        });
      }
      if (url.endsWith("/crm.deal.list")) {
        return jsonResponse({ result: [{ ID: "1" }], total: "42" });
      }
      throw new Error(`Неожиданный URL: ${url}`);
    },
  );
}

describe("normalizeBitrix24WebhookUrl", () => {
  it("нормализует базовый URL облачного вебхука", () => {
    expect(
      normalizeBitrix24WebhookUrl(
        "  https://atlas-test.bitrix24.ru/rest/7/abcDEF_123456  ",
      ),
    ).toBe(webhookUrl);
  });

  it.each([
    "http://atlas-test.bitrix24.ru/rest/7/abcDEF_123456/",
    "https://bitrix24.ru.evil.example/rest/7/abcDEF_123456/",
    "https://atlas-test.bitrix24.ru/rest/7/abcDEF_123456/crm.deal.list",
    "https://atlas-test.bitrix24.ru/rest/7/abcDEF_123456/?debug=1",
  ])("отклоняет небезопасный или не базовый URL: %s", (value) => {
    expect(() => normalizeBitrix24WebhookUrl(value)).toThrow();
  });
});

describe("Bitrix24Client", () => {
  it("проверяет профиль, воронки и доступ к сделкам", async () => {
    const request = successfulFetch();
    const client = new Bitrix24Client({
      webhookUrl,
      fetchImplementation: request as unknown as typeof fetch,
    });

    await expect(client.checkConnection()).resolves.toEqual({
      portal: "atlas-test.bitrix24.ru",
      user: { id: "7", name: "Анна Орлова" },
      funnelCount: 2,
      dealCount: 42,
    });
    expect(request).toHaveBeenCalledTimes(3);
    expect(String(request.mock.calls[0][0])).toBe(`${webhookUrl}profile`);
    expect(String(request.mock.calls[1][0])).toBe(
      `${webhookUrl}crm.category.list`,
    );
    expect(JSON.parse(String(request.mock.calls[1][1]?.body))).toEqual({
      entityTypeId: 2,
    });
    expect(String(request.mock.calls[2][0])).toBe(
      `${webhookUrl}crm.deal.list`,
    );
  });

  it("объясняет отсутствие права CRM", async () => {
    const request = vi
      .fn()
      .mockResolvedValueOnce(
        jsonResponse({ result: { ID: "7", NAME: "Анна" } }),
      )
      .mockResolvedValueOnce(
        jsonResponse(
          {
            error: "insufficient_scope",
            error_description: "The request requires higher privileges",
          },
          401,
        ),
      );
    const client = new Bitrix24Client({
      webhookUrl,
      fetchImplementation: request as unknown as typeof fetch,
    });

    await expect(client.checkConnection()).rejects.toThrow(
      "не хватает права «CRM»",
    );
    expect(request).toHaveBeenCalledTimes(2);
  });

  it("не включает секрет вебхука в сетевую ошибку", async () => {
    const request = vi.fn(async () => {
      throw new Error(`Нельзя подключиться к ${webhookUrl}`);
    });
    const client = new Bitrix24Client({
      webhookUrl,
      fetchImplementation: request as unknown as typeof fetch,
    });

    await expect(client.checkConnection()).rejects.toMatchObject({
      message: expect.not.stringContaining("abcDEF_123456"),
    });
  });

  it("прерывает зависшую проверку по таймауту", async () => {
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
    const client = new Bitrix24Client({
      webhookUrl,
      fetchImplementation: request as unknown as typeof fetch,
      timeoutMs: 5,
    });

    await expect(client.checkConnection()).rejects.toThrow(
      "не ответил за 0 сек.",
    );
  });

  it("загружает страницы сделок без клиентских полей и сохраняет точную сумму", async () => {
    const request = vi.fn(
      async (input: string | URL | Request, init?: RequestInit) => {
        const url = String(input);
        if (url.endsWith("/crm.category.list")) {
          return jsonResponse({
            result: {
              categories: [
                { id: 6, name: "Брендинг", isDefault: "N" },
              ],
            },
          });
        }
        if (url.endsWith("/crm.status.list")) {
          return jsonResponse({
            result: [
              {
                STATUS_ID: "C6:WON",
                NAME: "Оплачено",
                SORT: "50",
                EXTRA: { SEMANTICS: "success" },
              },
            ],
          });
        }
        if (url.endsWith("/crm.deal.list")) {
          const body = JSON.parse(String(init?.body)) as {
            start: number;
            select: string[];
          };
          expect(body.select).toEqual([
            "ID",
            "CATEGORY_ID",
            "STAGE_ID",
            "OPPORTUNITY",
            "CURRENCY_ID",
            "DATE_CREATE",
            "CLOSEDATE",
          ]);
          const result = [
            {
              ID: body.start === 0 ? "1" : "2",
              CATEGORY_ID: "6",
              STAGE_ID: "C6:WON",
              OPPORTUNITY: body.start === 0 ? "100.10" : "200.20",
              CURRENCY_ID: "RUB",
              DATE_CREATE: "2026-08-21T12:00:00+03:00",
              CLOSEDATE: "2026-09-03T12:00:00+03:00",
            },
          ];
          return jsonResponse(
            body.start === 0 ? { result, next: 50 } : { result },
          );
        }
        throw new Error(`Неожиданный URL: ${url}`);
      },
    );
    const client = new Bitrix24Client({
      webhookUrl,
      fetchImplementation: request as unknown as typeof fetch,
    });

    const result = await client.loadSalesSnapshot();

    expect(result.funnels).toHaveLength(1);
    expect(result.deals).toHaveLength(2);
    expect(result.deals.map((item) => item.opportunity.toFixed(2))).toEqual([
      "100.10",
      "200.20",
    ]);
    expect(result.deals[0]).not.toHaveProperty("title");
  });
});
