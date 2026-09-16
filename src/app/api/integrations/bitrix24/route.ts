import { NextResponse } from "next/server";

import { requireAdmin } from "@/lib/auth/server";
import { env } from "@/lib/env";
import {
  Bitrix24ApiError,
  Bitrix24Client,
  normalizeBitrix24WebhookUrl,
} from "@/services/bitrix24-client";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function configuredPortal() {
  if (!env.bitrix24WebhookUrl.trim()) return null;
  try {
    return new URL(
      normalizeBitrix24WebhookUrl(env.bitrix24WebhookUrl),
    ).hostname;
  } catch {
    return null;
  }
}

export async function GET() {
  const denied = await requireAdmin();
  if (denied) return denied;

  return NextResponse.json(
    {
      configured: Boolean(env.bitrix24WebhookUrl.trim()),
      portal: configuredPortal(),
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}

export async function POST(request: Request) {
  const denied = await requireAdmin();
  if (denied) return denied;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { error: "Тело запроса должно быть корректным JSON." },
      { status: 400 },
    );
  }

  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return NextResponse.json(
      { error: "Передайте параметры проверки Bitrix24 объектом." },
      { status: 400 },
    );
  }

  const candidate = (body as Record<string, unknown>).webhookUrl;
  if (candidate !== undefined && typeof candidate !== "string") {
    return NextResponse.json(
      { error: "URL вебхука должен быть строкой." },
      { status: 400 },
    );
  }

  const providedUrl = typeof candidate === "string" ? candidate.trim() : "";
  const webhookUrl = providedUrl || env.bitrix24WebhookUrl;

  try {
    const connection = await new Bitrix24Client({ webhookUrl }).checkConnection();
    return NextResponse.json(
      {
        connected: true,
        persistent: !providedUrl && Boolean(env.bitrix24WebhookUrl.trim()),
        ...connection,
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    const status =
      error instanceof Bitrix24ApiError && error.status
        ? error.status >= 400 && error.status < 500
          ? error.status
          : 502
        : 502;
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Проверка связи с Bitrix24 завершилась ошибкой.",
      },
      { status, headers: { "Cache-Control": "no-store" } },
    );
  }
}
