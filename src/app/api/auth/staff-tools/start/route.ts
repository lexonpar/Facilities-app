import { NextResponse } from "next/server";
import {
  INTENT_COOKIE,
  readFormField,
  TRANSITION_HEADERS,
  transitionEnabled,
  transitionUnavailable,
  trustedStaffToolsOrigin,
  verifyTransitionAssertion,
} from "@/lib/auth/staff-tools-transition";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  if (!transitionEnabled()) return transitionUnavailable(404);
  const trustedOrigin = trustedStaffToolsOrigin();
  if (!trustedOrigin) return transitionUnavailable(503);
  if (request.headers.get("origin") !== trustedOrigin) return transitionUnavailable(403);
  const assertion = await readFormField(request, "assertion", 2200);
  if (!assertion || !verifyTransitionAssertion(assertion)) return transitionUnavailable();
  const response = NextResponse.redirect(new URL("/auth/staff-tools/continue", request.url), {
    status: 303,
    headers: TRANSITION_HEADERS,
  });
  response.cookies.set(INTENT_COOKIE, assertion, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 60,
  });
  return response;
}
