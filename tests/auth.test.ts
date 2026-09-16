import { afterEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

import { POST as login } from "@/app/api/auth/login/route";
import { verifyCredentials } from "@/lib/auth/credentials";
import {
  createSessionToken,
  SESSION_MAX_AGE_SECONDS,
  verifySessionToken,
} from "@/lib/auth/session";
import { proxy } from "@/proxy";

function configureAuth() {
  vi.stubEnv("ADMIN_EMAIL", "admin@example.ru");
  vi.stubEnv("ADMIN_PASSWORD", "admin-secret");
  vi.stubEnv("OTHERS_PASSWORD", "shared-secret");
  vi.stubEnv("AUTH_SESSION_SECRET", "session-secret-for-tests");
}

afterEach(() => vi.unstubAllEnvs());

describe("авторизация Atlas", () => {
  it("выдаёт администратору полную роль только по его паре данных", () => {
    configureAuth();
    expect(verifyCredentials("ADMIN@example.ru", "admin-secret")).toBe(
      "admin",
    );
    expect(verifyCredentials("other@example.ru", "admin-secret")).toBeNull();
  });

  it("принимает любой корректный email с общим паролем", () => {
    configureAuth();
    expect(verifyCredentials("user@example.ru", "shared-secret")).toBe(
      "user",
    );
    expect(verifyCredentials("не-email", "shared-secret")).toBeNull();
  });

  it("проверяет подпись и срок действия сессии", () => {
    configureAuth();
    const now = Date.UTC(2026, 8, 15, 10, 0, 0);
    const token = createSessionToken("admin", now);

    expect(verifySessionToken(token, now)).toEqual({
      role: "admin",
      expiresAt: Math.floor(now / 1_000) + SESSION_MAX_AGE_SECONDS,
    });
    expect(verifySessionToken(`${token}x`, now)).toBeNull();
    expect(
      verifySessionToken(token, now + SESSION_MAX_AGE_SECONDS * 1_000),
    ).toBeNull();
  });

  it("устанавливает защищённую cookie и не помещает в неё учётные данные", async () => {
    configureAuth();
    const response = await login(
      new Request("http://localhost/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: "user@example.ru",
          password: "shared-secret",
        }),
      }),
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ role: "user" });
    const cookie = response.headers.get("set-cookie") ?? "";
    expect(cookie).toContain("atlas-session=");
    expect(cookie).toContain("HttpOnly");
    expect(cookie).toContain("SameSite=strict");
    expect(cookie).not.toContain("user@example.ru");
    expect(cookie).not.toContain("shared-secret");
  });

  it("перенаправляет на вход без сессии и пропускает подписанную сессию", () => {
    configureAuth();
    const unauthorized = proxy(new NextRequest("http://localhost/"));
    expect(unauthorized.status).toBe(307);
    expect(unauthorized.headers.get("location")).toBe(
      "http://localhost/login",
    );

    const token = createSessionToken("user");
    const authorized = proxy(
      new NextRequest("http://localhost/", {
        headers: { Cookie: `atlas-session=${token}` },
      }),
    );
    expect(authorized.status).toBe(200);
    expect(authorized.headers.get("x-middleware-next")).toBe("1");
  });
});
