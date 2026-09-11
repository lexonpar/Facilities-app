import { NextResponse } from "next/server";
import { setBrowserProfile } from "@/lib/auth/browser-session";
import {
  callOwnerBroker,
  isStaffToolsOrigin,
  OWNER_SSO_NO_STORE_HEADERS,
} from "@/lib/auth/owner-sso";
import { getStaffToolsOrigin } from "@/lib/config/integrations";
import { getFacilitiesAccess } from "@/lib/auth/session";
import { isAccessToken, isRefreshToken } from "@/lib/auth/session-tokens";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_BODY_BYTES = 128;

function ownerDashboardFailure() {
  try {
    const destination = new URL("/owner/dashboard", getStaffToolsOrigin());
    destination.searchParams.set("facilities", "unavailable");
    return NextResponse.redirect(destination, { status: 303, headers: OWNER_SSO_NO_STORE_HEADERS });
  } catch {
    return NextResponse.json({ ok: false, error: "Owner Facilities access is temporarily unavailable." }, { status: 503, headers: OWNER_SSO_NO_STORE_HEADERS });
  }
}

async function boundedTicket(request: Request) {
  const contentType = request.headers.get("content-type") ?? "";
  if (
    contentType.split(";", 1)[0]?.trim().toLowerCase() !==
      "application/x-www-form-urlencoded"
  ) {
    return null;
  }
  const contentLength = request.headers.get("content-length");
  if (
    contentLength &&
    (!/^\d+$/.test(contentLength) || Number(contentLength) > MAX_BODY_BYTES)
  ) {
    return null;
  }
  const text = await request.text();
  if (!text || text.length > MAX_BODY_BYTES) return null;
  const ticket = new URLSearchParams(text).get("ticket")?.trim() ?? "";
  return /^[A-Za-z0-9_-]{43}$/.test(ticket) ? ticket : null;
}

export async function POST(request: Request) {
  try {
    if (!isStaffToolsOrigin(request)) {
      return new Response(null, { status: 403, headers: OWNER_SSO_NO_STORE_HEADERS });
    }
  } catch {
    return ownerDashboardFailure();
  }

  let ticket: string | null = null;
  try {
    ticket = await boundedTicket(request);
  } catch {
    ticket = null;
  }
  if (!ticket) return ownerDashboardFailure();

  let stage = "broker_exchange";
  try {
    const broker = await callOwnerBroker({
      action: "owner_handoff_exchange",
      ticket,
    });
    if (
      !broker.response.ok ||
      broker.body?.ok !== true ||
      broker.body.role !== "admin" ||
      !isAccessToken(broker.body.accessToken) ||
      !isRefreshToken(broker.body.refreshToken)
    ) {
      throw new Error("Owner broker response was invalid.");
    }

    stage = "session_creation";
    const supabase = await createClient();
    const { data, error } = await supabase.auth.setSession({
      access_token: broker.body.accessToken,
      refresh_token: broker.body.refreshToken,
    });
    if (
      error ||
      !data.session ||
      !data.user ||
      data.user.id !== data.session.user.id
    ) {
      throw new Error("Owner Facilities session creation failed.");
    }
    stage = "authorization_check";
    const access = await getFacilitiesAccess(supabase, data.user.id);
    if (!access?.active || access.role !== "admin") {
      await supabase.auth.signOut();
      throw new Error("Owner Facilities authorization failed.");
    }

    const response = NextResponse.redirect(new URL("/", request.url), {
      status: 303,
      headers: OWNER_SSO_NO_STORE_HEADERS,
    });
    setBrowserProfile((name, value, options) => response.cookies.set(name, value, options), data.user.id);
    return response;
  } catch (error) {
    console.error("Owner Facilities handoff failed", {
      stage,
      reason: error instanceof Error ? error.message : "Unknown failure",
    });
    return ownerDashboardFailure();
  }
}
