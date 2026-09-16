import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

import {
  SESSION_COOKIE_NAME,
  verifySessionToken,
} from "@/lib/auth/session";

const PUBLIC_PATHS = new Set([
  "/login",
  "/api/auth/login",
  "/api/auth/logout",
  "/api/health",
  "/api/integrations/google-sheets/marketing-actual",
]);

export function proxy(request: NextRequest) {
  const path = request.nextUrl.pathname;
  const session = verifySessionToken(
    request.cookies.get(SESSION_COOKIE_NAME)?.value,
  );

  if (PUBLIC_PATHS.has(path)) {
    if (path === "/login" && session) {
      return NextResponse.redirect(new URL("/", request.url));
    }
    return NextResponse.next();
  }

  if (session) return NextResponse.next();

  if (path.startsWith("/api/")) {
    return NextResponse.json(
      { error: "Необходимо войти в систему." },
      { status: 401 },
    );
  }

  return NextResponse.redirect(new URL("/login", request.url));
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|robots.txt|sitemap.xml|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
