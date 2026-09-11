import { NextResponse } from "next/server";
import {
  callOwnerBroker,
  OWNER_SSO_NO_STORE_HEADERS,
} from "@/lib/auth/owner-sso";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_BODY_BYTES = 4_096;

async function boundedAssertion(request: Request) {
  const contentType = request.headers.get("content-type") ?? "";
  if (contentType.split(";", 1)[0]?.trim().toLowerCase() !== "application/json") {
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
  try {
    const parsed: unknown = JSON.parse(text);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
    const assertion = (parsed as { assertion?: unknown }).assertion;
    return typeof assertion === "string" &&
        assertion.length <= 4_000 &&
        /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(assertion)
      ? assertion
      : null;
  } catch {
    return null;
  }
}

export async function POST(request: Request) {
  let assertion: string | null = null;
  try {
    assertion = await boundedAssertion(request);
  } catch {
    assertion = null;
  }
  if (!assertion) {
    return NextResponse.json(
      { ok: false, error: "Invalid owner handoff request." },
      { status: 400, headers: OWNER_SSO_NO_STORE_HEADERS },
    );
  }

  try {
    const broker = await callOwnerBroker({
      action: "owner_handoff_create",
      assertion,
    });
    if (
      !broker.response.ok ||
      broker.body?.ok !== true ||
      typeof broker.body.ticket !== "string" ||
      !/^[A-Za-z0-9_-]{43}$/.test(broker.body.ticket) ||
      typeof broker.body.expiresIn !== "number" ||
      broker.body.expiresIn < 1 ||
      broker.body.expiresIn > 60
    ) {
      return NextResponse.json(
        { ok: false, error: "Owner handoff could not be issued." },
        {
          status: broker.response.status === 401 ? 401 : 503,
          headers: OWNER_SSO_NO_STORE_HEADERS,
        },
      );
    }
    return NextResponse.json(
      {
        ok: true,
        ticket: broker.body.ticket,
        expiresIn: broker.body.expiresIn,
      },
      { headers: OWNER_SSO_NO_STORE_HEADERS },
    );
  } catch {
    return NextResponse.json(
      { ok: false, error: "Owner handoff is temporarily unavailable." },
      { status: 503, headers: OWNER_SSO_NO_STORE_HEADERS },
    );
  }
}
