import "server-only";

import { cookies } from "next/headers";
import { NextResponse } from "next/server";

import {
  SESSION_COOKIE_NAME,
  verifySessionToken,
} from "@/lib/auth/session";

export async function getCurrentSession() {
  const token = (await cookies()).get(SESSION_COOKIE_NAME)?.value;
  return verifySessionToken(token);
}

export async function requireAdmin() {
  const session = await getCurrentSession();
  if (!session) {
    return NextResponse.json(
      { error: "Необходимо войти в систему." },
      { status: 401 },
    );
  }
  if (session.role !== "admin") {
    return NextResponse.json(
      { error: "Действие доступно только администратору." },
      { status: 403 },
    );
  }
  return null;
}
