import { NextResponse } from "next/server";

import { getAuthConfig, isAuthConfigured } from "@/lib/auth/config";
import { verifyCredentials } from "@/lib/auth/credentials";
import {
  createSessionToken,
  SESSION_COOKIE_NAME,
  SESSION_MAX_AGE_SECONDS,
} from "@/lib/auth/session";

export const runtime = "nodejs";

const MAX_BODY_BYTES = 4_096;

export async function POST(request: Request) {
  if (!isAuthConfigured(getAuthConfig())) {
    return NextResponse.json(
      { error: "Авторизация не настроена на сервере." },
      { status: 503 },
    );
  }

  const contentLength = Number(request.headers.get("content-length") ?? 0);
  if (contentLength > MAX_BODY_BYTES) {
    return NextResponse.json(
      { error: "Слишком большой запрос." },
      { status: 413 },
    );
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { error: "Введите электронную почту и пароль." },
      { status: 400 },
    );
  }

  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return NextResponse.json(
      { error: "Введите электронную почту и пароль." },
      { status: 400 },
    );
  }

  const email = (body as Record<string, unknown>).email;
  const password = (body as Record<string, unknown>).password;
  if (typeof email !== "string" || typeof password !== "string") {
    return NextResponse.json(
      { error: "Введите электронную почту и пароль." },
      { status: 400 },
    );
  }

  const role = verifyCredentials(email, password);
  if (!role) {
    return NextResponse.json(
      { error: "Неверная электронная почта или пароль." },
      { status: 401 },
    );
  }

  const response = NextResponse.json({ role });
  response.cookies.set(SESSION_COOKIE_NAME, createSessionToken(role), {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "strict",
    maxAge: SESSION_MAX_AGE_SECONDS,
    path: "/",
    priority: "high",
  });
  return response;
}
