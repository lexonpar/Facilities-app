import { NextResponse, type NextRequest } from "next/server";
import {
  isSameOriginRequest,
  PRIVATE_NO_STORE_HEADERS,
} from "@/lib/http/request-security";
import { createTransitionSession } from "@/lib/auth/transition-session";
import { clearBrowserSession } from "@/lib/auth/browser-session";

export async function POST(request: NextRequest) {
  if (!isSameOriginRequest(request)) {
    return NextResponse.json(
      { error: "Invalid request origin" },
      { status: 403, headers: PRIVATE_NO_STORE_HEADERS },
    );
  }

  let session: ReturnType<typeof createTransitionSession> | null = null;
  let remoteRevocationConfirmed = false;
  try {
    session = createTransitionSession(request);
    const { error } = await session.bounded(() => session!.supabase.auth.signOut({ scope: "local" }));
    remoteRevocationConfirmed = !error;
  } catch {
    // Local cleanup must still complete when the authentication service is down.
  }
  const response = NextResponse.json({ ok: true, remoteRevocationConfirmed }, { headers: PRIVATE_NO_STORE_HEADERS });
  if (session) session.clearCookies(response);
  else clearBrowserSession((name, value, options) => response.cookies.set(name, value, options), request.cookies.getAll());
  return response;
}
