import { NextResponse } from "next/server";

import { env } from "@/lib/env";
import { verifyMarketingActualSignature } from "@/services/marketing-actual-auth";
import {
  MarketingActualWebhookError,
  parseMarketingActualCommand,
  processMarketingActualCommand,
} from "@/services/marketing-actual-webhook";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const MAX_BODY_BYTES = 1_500_000;

export async function POST(request: Request) {
  const contentLength = Number(request.headers.get("content-length") ?? 0);
  if (contentLength > MAX_BODY_BYTES) {
    return NextResponse.json(
      { error: "Тело webhook превышает допустимый размер." },
      { status: 413 },
    );
  }

  const rawBody = await request.text();
  if (Buffer.byteLength(rawBody, "utf8") > MAX_BODY_BYTES) {
    return NextResponse.json(
      { error: "Тело webhook превышает допустимый размер." },
      { status: 413 },
    );
  }

  let auth;
  try {
    auth = verifyMarketingActualSignature({
      rawBody,
      timestamp: request.headers.get("x-atlas-timestamp"),
      eventId: request.headers.get("x-atlas-event-id"),
      signature: request.headers.get("x-atlas-signature"),
      secret: env.marketingActualWebhookSecret,
    });
  } catch (error) {
    const message =
      error instanceof Error
        ? error.message
        : "Webhook не прошёл проверку подлинности.";
    return NextResponse.json(
      { error: message },
      { status: message.includes("не настроен") ? 503 : 401 },
    );
  }

  try {
    const command = parseMarketingActualCommand(rawBody);
    const result = await processMarketingActualCommand(
      command,
      auth.eventId,
      auth.eventTime,
    );
    return NextResponse.json(result);
  } catch (error) {
    if (error instanceof MarketingActualWebhookError) {
      console.warn("Webhook маркетингового факта отклонён:", error.message);
      return NextResponse.json(
        { error: error.message },
        { status: error.status },
      );
    }
    return NextResponse.json(
      { error: "Не удалось обработать маркетинговый факт." },
      { status: 500 },
    );
  }
}
