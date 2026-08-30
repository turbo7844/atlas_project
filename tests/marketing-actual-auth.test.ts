import { describe, expect, it } from "vitest";

import {
  createMarketingActualSignature,
  verifyMarketingActualSignature,
} from "@/services/marketing-actual-auth";

describe("подпись webhook маркетингового факта", () => {
  const secret = "секрет-для-теста";
  const timestamp = "1787950800";
  const eventId = "event-1";
  const rawBody = '{"version":1,"mode":"patch"}';
  const now = new Date(Number(timestamp) * 1_000);

  it("принимает корректную HMAC-SHA256", () => {
    const signature = createMarketingActualSignature(
      secret,
      timestamp,
      eventId,
      rawBody,
    );

    expect(
      verifyMarketingActualSignature({
        rawBody,
        timestamp,
        eventId,
        signature,
        secret,
        now,
      }),
    ).toEqual({ eventId, eventTime: now });
  });

  it("отклоняет изменённое тело", () => {
    const signature = createMarketingActualSignature(
      secret,
      timestamp,
      eventId,
      rawBody,
    );

    expect(() =>
      verifyMarketingActualSignature({
        rawBody: rawBody + " ",
        timestamp,
        eventId,
        signature,
        secret,
        now,
      }),
    ).toThrow("не прошла проверку");
  });

  it("отклоняет просроченный timestamp", () => {
    const signature = createMarketingActualSignature(
      secret,
      timestamp,
      eventId,
      rawBody,
    );

    expect(() =>
      verifyMarketingActualSignature({
        rawBody,
        timestamp,
        eventId,
        signature,
        secret,
        now: new Date(now.getTime() + 301_000),
      }),
    ).toThrow("пятиминутное окно");
  });
});
