import {
  createHmac,
  timingSafeEqual,
} from "node:crypto";

const MAX_TIMESTAMP_SKEW_SECONDS = 5 * 60;
const EVENT_ID_PATTERN = /^[A-Za-z0-9._:-]{1,128}$/;
const SIGNATURE_PATTERN = /^[a-f0-9]{64}$/i;

export interface MarketingActualSignatureInput {
  rawBody: string;
  timestamp: string | null;
  eventId: string | null;
  signature: string | null;
  secret: string;
  now?: Date;
}

export function createMarketingActualSignature(
  secret: string,
  timestamp: string,
  eventId: string,
  rawBody: string,
) {
  return createHmac("sha256", secret)
    .update(`${timestamp}\n${eventId}\n${rawBody}`)
    .digest("hex");
}

export function verifyMarketingActualSignature({
  rawBody,
  timestamp,
  eventId,
  signature,
  secret,
  now = new Date(),
}: MarketingActualSignatureInput) {
  if (!secret) {
    throw new Error("Секрет webhook для маркетингового факта не настроен.");
  }
  if (!timestamp || !/^\d{10}$/.test(timestamp)) {
    throw new Error("Заголовок времени webhook задан неверно.");
  }
  if (!eventId || !EVENT_ID_PATTERN.test(eventId)) {
    throw new Error("Идентификатор события webhook задан неверно.");
  }
  if (!signature || !SIGNATURE_PATTERN.test(signature)) {
    throw new Error("Подпись webhook задана неверно.");
  }

  const eventTime = Number(timestamp);
  const nowSeconds = Math.floor(now.getTime() / 1_000);
  if (Math.abs(nowSeconds - eventTime) > MAX_TIMESTAMP_SKEW_SECONDS) {
    throw new Error("Время webhook вышло за допустимое пятиминутное окно.");
  }

  const expected = Buffer.from(
    createMarketingActualSignature(secret, timestamp, eventId, rawBody),
    "hex",
  );
  const provided = Buffer.from(signature, "hex");
  if (
    expected.length !== provided.length ||
    !timingSafeEqual(expected, provided)
  ) {
    throw new Error("Подпись webhook не прошла проверку.");
  }

  return { eventId, eventTime: new Date(eventTime * 1_000) };
}
