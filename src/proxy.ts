import { NextResponse, type NextRequest } from "next/server";
import {
  getFacilitiesAccess,
  type FacilitiesAccess,
} from "@/lib/auth/session";
import { createMiddlewareSupabase } from "@/lib/supabase/middleware";
import {
  BROWSER_PROFILE_COOKIE,
  BLOCKED_BROWSER_PROFILE,
  browserProfileAllows,
  browserProfileIsBlocked,
  clearBrowserSession,
  supabaseCookieNames,
} from "@/lib/auth/browser-session";
import { PRIVATE_NO_STORE_HEADERS } from "@/lib/http/request-security";
import {
  canAccessManagerDashboard,
  canManageTeam,
  canSubmitIssues,
} from "@/lib/types/profile";

const SESSION_CACHE_HEADERS = ["cache-control", "expires", "pragma"] as const;

function isRoute(pathname: string, route: string) {
  return pathname === route || pathname.startsWith(`${route}/`);
}

function requiredArea(pathname: string) {
  if (isRoute(pathname, "/admin")) return "admin";
  if (isRoute(pathname, "/lead")) return "lead";
  if (isRoute(pathname, "/submit")) return "submit";
  return null;
}

function canAccessPath(access: FacilitiesAccess, pathname: string) {
  if (!access.active) return false;

  const area = requiredArea(pathname);
  if (area === "admin") return canManageTeam(access.role);
  if (area === "lead") return canAccessManagerDashboard(access.role);
  if (area === "submit") return canSubmitIssues(access.role);
  return true;
}

function defaultDestination(access: FacilitiesAccess) {
  return canAccessManagerDashboard(access.role) ? "/lead" : "/submit";
}

function safeLocalDestination(
  request: NextRequest,
  value: string | null,
  access: FacilitiesAccess,
) {
  const fallback = defaultDestination(access);
  if (!value) return fallback;

  try {
    const target = new URL(value, request.url);
    if (
      target.origin !== request.nextUrl.origin ||
      target.pathname === "/login" ||
      !canAccessPath(access, target.pathname)
    ) {
      return fallback;
    }
    return `${target.pathname}${target.search}${target.hash}`;
  } catch {
    return fallback;
  }
}

function copySessionState(source: NextResponse, destination: NextResponse) {
  source.cookies.getAll().forEach((cookie) => destination.cookies.set(cookie));
  SESSION_CACHE_HEADERS.forEach((header) => {
    const value = source.headers.get(header);
    if (value) destination.headers.set(header, value);
  });
  return destination;
}

function redirectWithSession(
  request: NextRequest,
  source: NextResponse,
  destination: string | URL,
) {
  return copySessionState(
    source,
    NextResponse.redirect(new URL(destination, request.url)),
  );
}

export async function proxy(request: NextRequest) {
  const pathname = request.nextUrl.pathname;
  const area = requiredArea(pathname);
  const isLogin = pathname === "/login";
  // These routes own their cookie lifecycle. Never refresh the previous account
  // before they can read Lax cookies, authenticate, or unconditionally clear it.
  if ([
    "/api/auth/staff-tools/start",
    "/auth/staff-tools/continue",
    "/api/auth/staff-tools/complete",
    "/api/auth/punch/login",
    "/api/auth/owner/handoff",
    "/api/auth/signout",
    "/staff-tools",
    "/staff-tools/owner",
  ].includes(pathname)) return NextResponse.next({ request });

  const originalCookies = request.cookies.getAll();
  const binding = request.cookies.get(BROWSER_PROFILE_COOKIE)?.value;
  function blockedResponse(extraCookies: { name: string }[] = []) {
    supabaseCookieNames([...originalCookies, ...extraCookies]).forEach((name) => request.cookies.delete(name));
    request.cookies.set(BROWSER_PROFILE_COOKIE, BLOCKED_BROWSER_PROFILE);
    const response = area
      ? NextResponse.redirect(new URL("/login?reason=shared-device", request.url))
      : NextResponse.next({ request });
    clearBrowserSession((name, value, options) => response.cookies.set(name, value, options), [...originalCookies, ...extraCookies]);
    Object.entries(PRIVATE_NO_STORE_HEADERS).forEach(([name, value]) => response.headers.set(name, value));
    return response;
  }
  if (browserProfileIsBlocked(binding)) return blockedResponse();
  let ctx;
  try {
    ctx = createMiddlewareSupabase(request, NextResponse.next({ request }));
  } catch {
    return NextResponse.json({ error: "Facilities is temporarily unavailable." }, { status: 503, headers: PRIVATE_NO_STORE_HEADERS });
  }

  if (!ctx) {
    if (!area) return NextResponse.next({ request });
    const login = new URL("/login", request.url);
    login.searchParams.set("error", "access");
    login.searchParams.set("next", `${pathname}${request.nextUrl.search}`);
    return NextResponse.redirect(login);
  }

  const {
    data: { user },
  } = await ctx.supabase.auth.getUser();
  const sessionResponse = ctx.getResponse();

  if (user && !browserProfileAllows(binding, user.id)) {
    return blockedResponse(sessionResponse.cookies.getAll());
  }

  if (!user) {
    if (!area) return sessionResponse;
    const login = new URL("/login", request.url);
    login.searchParams.set("next", `${pathname}${request.nextUrl.search}`);
    return redirectWithSession(request, sessionResponse, login);
  }

  if (!isLogin && !area) return sessionResponse;

  const access = await getFacilitiesAccess(ctx.supabase, user.id);
  if (!access?.active || !canSubmitIssues(access.role)) {
    if (!area) return sessionResponse;
    const login = new URL("/login", request.url);
    login.searchParams.set("error", "access");
    login.searchParams.set("next", `${pathname}${request.nextUrl.search}`);
    return redirectWithSession(request, sessionResponse, login);
  }

  if (isLogin) {
    const destination = safeLocalDestination(
      request,
      request.nextUrl.searchParams.get("next"),
      access,
    );
    return redirectWithSession(request, sessionResponse, destination);
  }

  if (!canAccessPath(access, pathname)) {
    return redirectWithSession(
      request,
      sessionResponse,
      defaultDestination(access),
    );
  }

  return sessionResponse;
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
