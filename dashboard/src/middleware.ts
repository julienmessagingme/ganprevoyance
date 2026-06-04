import { NextRequest, NextResponse } from "next/server";
import { verifySession, SESSION_COOKIE_NAME } from "@/lib/auth/session";

const PUBLIC_PATHS = new Set([
  "/login",
  "/api/auth/login",
  "/api/auth/logout",
  // /api/cron/sync uses its own Bearer auth (INTERNAL_API_KEY) and must be
  // callable from outside the browser session. Middleware would otherwise
  // 307 it to /login.
  "/api/cron/sync",
]);

function isPublic(pathname: string): boolean {
  if (pathname.startsWith("/r/")) return true;
  if (pathname.startsWith("/_next/") || pathname.startsWith("/favicon")) return true;
  // Static assets served from /public must be reachable on the /login page
  // (which renders before any session is established) — most importantly
  // the school logos shown in the auth-gated shell.
  if (pathname.startsWith("/logos/")) return true;
  return PUBLIC_PATHS.has(pathname);
}

export async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;
  if (isPublic(pathname)) return NextResponse.next();

  const token = req.cookies.get(SESSION_COOKIE_NAME)?.value;
  const payload = token ? await verifySession(token) : null;
  if (!payload) {
    const url = req.nextUrl.clone();
    url.pathname = "/login";
    url.search = "";
    return NextResponse.redirect(url);
  }
  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
