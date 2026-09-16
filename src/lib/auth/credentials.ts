import { createHash, timingSafeEqual } from "node:crypto";

import { getAuthConfig, isAuthConfigured } from "@/lib/auth/config";
import type { AuthRole } from "@/lib/auth/session";

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function equalSecret(left: string, right: string) {
  const leftHash = createHash("sha256").update(left).digest();
  const rightHash = createHash("sha256").update(right).digest();
  return timingSafeEqual(leftHash, rightHash);
}

export function isValidEmail(value: string) {
  return value.length <= 254 && EMAIL_PATTERN.test(value);
}

export function verifyCredentials(
  email: string,
  password: string,
): AuthRole | null {
  const config = getAuthConfig();
  if (!isAuthConfigured(config)) return null;

  const normalizedEmail = email.trim().toLowerCase();
  if (!isValidEmail(normalizedEmail) || password.length > 256) return null;

  if (
    equalSecret(normalizedEmail, config.adminEmail) &&
    equalSecret(password, config.adminPassword)
  ) {
    return "admin";
  }

  return equalSecret(password, config.othersPassword) ? "user" : null;
}
