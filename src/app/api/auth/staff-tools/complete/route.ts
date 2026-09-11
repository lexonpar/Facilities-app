import type { NextRequest } from "next/server";
import {
  BROWSER_PROFILE_COOKIE,
  clearBrowserSession,
} from "@/lib/auth/browser-session";
import {
  INTENT_COOKIE,
  matchesEmployeeIdentity,
  readFormField,
  transitionEnabled,
  transitionResultPage,
  transitionUnavailable,
  verifyTransitionAssertion,
} from "@/lib/auth/staff-tools-transition";
import { createTransitionSession } from "@/lib/auth/transition-session";
import { isSameOriginRequest } from "@/lib/http/request-security";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  if (!transitionEnabled()) return transitionUnavailable(404);
  if (!isSameOriginRequest(request)) return transitionUnavailable(403);
  const intent = verifyTransitionAssertion(request.cookies.get(INTENT_COOKIE)?.value ?? "");
  const jti = await readFormField(request, "jti", 128);
  if (!intent || intent.jti !== jti) {
    const response = transitionUnavailable();
    response.cookies.delete(INTENT_COOKIE);
    return response;
  }

  let session: ReturnType<typeof createTransitionSession> | null = null;
  let remoteUnconfirmed = false;
  try {
    session = createTransitionSession(request);
    if (intent.purpose === "employee_launch") {
      const client = session.supabase;
      const matchedUser = await session.bounded(async () => {
        const { data, error } = await client.auth.getUser();
        // Legacy sessions without a binding sign in once after rollout. Only
        // explicit authentication may establish/rebind the browser profile.
        if (error || !data.user || request.cookies.get(BROWSER_PROFILE_COOKIE)?.value !== data.user.id) return null;
        return await matchesEmployeeIdentity(client, data.user.id, intent.sub) ? data.user : null;
      });
      if (matchedUser) {
        const response = transitionResultPage("home", false, false);
        session.preserveCookies(response);
        // Never rewrite the binding here: a delayed preserved-session response
        // must not undo a newer logout or another employee's explicit sign-in.
        response.cookies.delete(INTENT_COOKIE);
        return response;
      }
    }
    const { error } = await session.bounded(() => session!.supabase.auth.signOut({ scope: "local" }));
    remoteUnconfirmed = Boolean(error);
  } catch {
    remoteUnconfirmed = true;
  }

  let response;
  try {
    response = transitionResultPage(intent.purpose === "logout" ? "logout" : "login", true, remoteUnconfirmed);
  } catch {
    // Never fall back to production or skip local cleanup if a target is invalid.
    response = transitionUnavailable(503);
  }
  if (session) session.clearCookies(response);
  else clearBrowserSession((name, value, options) => response.cookies.set(name, value, options), request.cookies.getAll());
  response.cookies.delete(INTENT_COOKIE);
  if (remoteUnconfirmed) console.warn("Facilities browser session cleared; remote revocation was not confirmed.");
  return response;
}
