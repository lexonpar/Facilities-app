import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { setBrowserProfile } from "@/lib/auth/browser-session";
import {
  getSupabaseAnonKey,
  getSupabaseUrl,
} from "@/lib/supabase/env";
import { createClient } from "@/lib/supabase/server";
import { isAccessToken, isRefreshToken } from "@/lib/auth/session-tokens";
import type { UserRole } from "@/lib/types/profile";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_BODY_BYTES = 1_024;
const MAX_BROKER_RESPONSE_BYTES = 16_384;
const BROKER_TIMEOUT_MS = 20_000;
const NO_STORE_HEADERS = { "Cache-Control": "private, no-store" };

type PunchLoginBody = {
  employeeId?: unknown;
  punchId?: unknown;
};

type BrokerResponse = {
  ok?: unknown;
  code?: unknown;
  error?: unknown;
  role?: unknown;
  accessToken?: unknown;
  refreshToken?: unknown;
};

const SAFE_BROKER_ERRORS: Record<string, string> = {
  account_inactive:
    "This Facilities account is inactive. Ask a manager to sync 7shifts.",
  invalid_login: "That Punch ID didn’t match. Check it and try again.",
  login_locked: "Too many sign-in attempts. Try again later.",
  punch_id_not_ready:
    "This profile is not ready for Punch ID sign-in. Ask a manager to sync 7shifts.",
};

function responseHeaders(retryAfter: string | null = null) {
  const headers = new Headers(NO_STORE_HEADERS);
  if (retryAfter && /^\d{1,6}$/.test(retryAfter)) {
    headers.set("Retry-After", retryAfter);
  }
  return headers;
}

function sameOrigin(request: Request) {
  const origin = request.headers.get("origin");
  return origin !== null && origin === new URL(request.url).origin;
}

async function boundedJson(request: Request): Promise<PunchLoginBody | null> {
  const contentLength = request.headers.get("content-length");
  if (
    contentLength &&
    (!/^\d+$/.test(contentLength) || Number(contentLength) > MAX_BODY_BYTES)
  ) {
    return null;
  }
  const text = await request.text();
  if (!text || text.length > MAX_BODY_BYTES) return null;
  try {
    const parsed: unknown = JSON.parse(text);
    return parsed !== null && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as PunchLoginBody)
      : null;
  } catch {
    return null;
  }
}

async function boundedBrokerResponse(
  response: Response,
): Promise<BrokerResponse | null> {
  const text = await response.text();
  if (!text || text.length > MAX_BROKER_RESPONSE_BYTES) return null;
  try {
    const parsed: unknown = JSON.parse(text);
    return parsed !== null && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as BrokerResponse)
      : null;
  } catch {
    return null;
  }
}

function isUserRole(value: unknown): value is UserRole {
  return (
    value === "pending" ||
    value === "staff" ||
    value === "manager" ||
    value === "admin"
  );
}

function brokerFailure(response: Response, body: BrokerResponse | null) {
  const code = typeof body?.code === "string" ? body.code : "login_unavailable";
  const safeMessage = SAFE_BROKER_ERRORS[code];
  const status =
    safeMessage && [401, 403, 409, 429].includes(response.status)
      ? response.status
      : 503;

  return NextResponse.json(
    {
      ok: false,
      code: safeMessage ? code : "login_unavailable",
      error:
        safeMessage ??
        "Punch ID sign-in is temporarily unavailable. Please try again shortly.",
    },
    {
      status,
      headers: responseHeaders(response.headers.get("retry-after")),
    },
  );
}

export async function POST(request: Request) {
  if (!sameOrigin(request)) {
    return NextResponse.json(
      {
        ok: false,
        code: "invalid_origin",
        error: "Request origin is not allowed.",
      },
      { status: 403, headers: NO_STORE_HEADERS },
    );
  }

  let body: PunchLoginBody | null;
  try {
    body = await boundedJson(request);
  } catch {
    body = null;
  }
  const employeeId =
    typeof body?.employeeId === "string" ? body.employeeId.trim() : "";
  const punchId = typeof body?.punchId === "string" ? body.punchId.trim() : "";
  if (!/^[A-Za-z0-9_-]{1,80}$/.test(employeeId) || !/^\d{1,12}$/.test(punchId)) {
    return NextResponse.json(
      {
        ok: false,
        code: "invalid_login",
        error: "That Punch ID didn’t match. Check it and try again.",
      },
      { status: 401, headers: NO_STORE_HEADERS },
    );
  }

  let supabaseUrl = "";
  let publishableKey = "";
  try {
    supabaseUrl = getSupabaseUrl().replace(/\/+$/, "");
    publishableKey = getSupabaseAnonKey();
  } catch {
    // The same unavailable response covers missing and mixed staging settings.
  }
  if (!supabaseUrl || !publishableKey) {
    return NextResponse.json(
      {
        ok: false,
        code: "login_unavailable",
        error: "Punch ID sign-in is temporarily unavailable. Please try again shortly.",
      },
      { status: 503, headers: NO_STORE_HEADERS },
    );
  }

  let brokerResponse: Response;
  try {
    brokerResponse = await fetch(
      `${supabaseUrl}/functions/v1/facilities-auth`,
      {
        method: "POST",
        cache: "no-store",
        redirect: "error",
        headers: {
          Accept: "application/json",
          apikey: publishableKey,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ action: "login", employeeId, punchId }),
        signal: AbortSignal.timeout(BROKER_TIMEOUT_MS),
      },
    );
  } catch {
    return NextResponse.json(
      {
        ok: false,
        code: "login_unavailable",
        error: "Punch ID sign-in is temporarily unavailable. Please try again shortly.",
      },
      { status: 503, headers: NO_STORE_HEADERS },
    );
  }

  const brokerBody = await boundedBrokerResponse(brokerResponse);
  if (!brokerResponse.ok || brokerBody?.ok !== true) {
    return brokerFailure(brokerResponse, brokerBody);
  }
  if (
    !isUserRole(brokerBody.role) ||
    !isAccessToken(brokerBody.accessToken) ||
    !isRefreshToken(brokerBody.refreshToken)
  ) {
    return NextResponse.json(
      {
        ok: false,
        code: "login_unavailable",
        error: "Punch ID sign-in is temporarily unavailable. Please try again shortly.",
      },
      { status: 503, headers: NO_STORE_HEADERS },
    );
  }

  try {
    const supabase = await createClient();
    const { data, error } = await supabase.auth.setSession({
      access_token: brokerBody.accessToken,
      refresh_token: brokerBody.refreshToken,
    });
    if (
      error ||
      !data.session ||
      !data.user ||
      data.user.id !== data.session.user.id
    ) {
      throw new Error("Facilities session creation failed");
    }
    const cookieStore = await cookies();
    setBrowserProfile((name, value, options) => cookieStore.set(name, value, options), data.user.id);
  } catch {
    return NextResponse.json(
      {
        ok: false,
        code: "login_unavailable",
        error: "Punch ID sign-in is temporarily unavailable. Please try again shortly.",
      },
      { status: 503, headers: NO_STORE_HEADERS },
    );
  }

  const role = brokerBody.role;
  return NextResponse.json(
    {
      ok: true,
      role,
      redirect: role === "manager" || role === "admin" ? "/lead" : "/submit",
    },
    { headers: NO_STORE_HEADERS },
  );
}
