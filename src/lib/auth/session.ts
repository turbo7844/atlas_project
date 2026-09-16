import { createHash, createHmac, timingSafeEqual } from "node:crypto";

import { getAuthConfig, isAuthConfigured } from "@/lib/auth/config";

export const SESSION_COOKIE_NAME = "atlas-session";
export const SESSION_MAX_AGE_SECONDS = 12 * 60 * 60;

export type AuthRole = "admin" | "user";

export type AuthSession = {
  role: AuthRole;
  expiresAt: number;
};

type SessionPayload = {
  version: 1;
  role: AuthRole;
  expiresAt: number;
};

function sessionKey() {
  const config = getAuthConfig();
  return createHash("sha256")
    .update("atlas-session-v1\u0000")
    .update(config.sessionSecret)
    .digest();
}

function signature(payload: string) {
  return createHmac("sha256", sessionKey())
    .update(payload)
    .digest("base64url");
}

function equalSignature(left: string, right: string) {
  try {
    const leftBytes = Buffer.from(left, "base64url");
    const rightBytes = Buffer.from(right, "base64url");
    return (
      leftBytes.length === rightBytes.length &&
      timingSafeEqual(leftBytes, rightBytes)
    );
  } catch {
    return false;
  }
}

export function createSessionToken(
  role: AuthRole,
  now = Date.now(),
): string {
  if (!isAuthConfigured()) {
    throw new Error("Авторизация не настроена.");
  }

  const payload: SessionPayload = {
    version: 1,
    role,
    expiresAt: Math.floor(now / 1_000) + SESSION_MAX_AGE_SECONDS,
  };
  const encodedPayload = Buffer.from(JSON.stringify(payload)).toString(
    "base64url",
  );
  return `${encodedPayload}.${signature(encodedPayload)}`;
}

export function verifySessionToken(
  token: string | undefined,
  now = Date.now(),
): AuthSession | null {
  if (!token || !isAuthConfigured()) return null;

  const parts = token.split(".");
  if (parts.length !== 2 || !equalSignature(parts[1], signature(parts[0]))) {
    return null;
  }

  try {
    const payload = JSON.parse(
      Buffer.from(parts[0], "base64url").toString("utf8"),
    ) as Partial<SessionPayload>;
    const role = payload.role;
    const expiresAt = payload.expiresAt;
    if (
      payload.version !== 1 ||
      (role !== "admin" && role !== "user") ||
      typeof expiresAt !== "number" ||
      !Number.isInteger(expiresAt) ||
      expiresAt <= Math.floor(now / 1_000)
    ) {
      return null;
    }
    return { role, expiresAt };
  } catch {
    return null;
  }
}
