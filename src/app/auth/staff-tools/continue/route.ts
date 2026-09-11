import type { NextRequest } from "next/server";
import {
  continueTransitionPage,
  INTENT_COOKIE,
  transitionEnabled,
  transitionUnavailable,
  verifyTransitionAssertion,
} from "@/lib/auth/staff-tools-transition";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  if (!transitionEnabled()) return transitionUnavailable(404);
  const intent = verifyTransitionAssertion(request.cookies.get(INTENT_COOKIE)?.value ?? "");
  if (!intent) {
    const response = transitionUnavailable();
    response.cookies.delete(INTENT_COOKIE);
    return response;
  }
  // This top-level GET receives existing SameSite=Lax auth cookies. It only
  // renders the form; the same-origin POST performs the account transition.
  return continueTransitionPage(intent.jti);
}
