import "server-only";

import { createPublicKey, randomBytes, verify } from "node:crypto";
import { NextResponse } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { PRIVATE_NO_STORE_HEADERS } from "@/lib/http/request-security";
import { SESSION_RESET_CHANNEL, SESSION_RESET_STORAGE_KEY } from "@/lib/auth/browser-session";
import { getShiftFlowOrigin, getStaffToolsOrigin, getTransitionPublicKey } from "@/lib/config/integrations";

export const INTENT_COOKIE = "facilities_staff_tools_intent";
export const TRANSITION_PATHS = [
  "/api/auth/staff-tools/start",
  "/auth/staff-tools/continue",
  "/api/auth/staff-tools/complete",
] as const;
const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const EMPLOYEE_ID = /^[A-Za-z0-9_-]{1,80}$/;
export const TRANSITION_HEADERS = {
  ...PRIVATE_NO_STORE_HEADERS,
  "Referrer-Policy": "no-referrer",
  "X-Content-Type-Options": "nosniff",
};

type CommonIntent = {
  jti: string;
  iat: number;
  exp: number;
};
export type TransitionIntent = CommonIntent & (
  | { purpose: "employee_launch"; sub: string; roster_source: "shiftflow"; company_id: "on-par" }
  | { purpose: "logout"; sub: "staff-tools-logout" }
);

export function transitionEnabled() {
  return process.env.STAFF_TOOLS_SESSION_TRANSITION_ENABLED?.trim().toLowerCase() === "true";
}

export function trustedStaffToolsOrigin(): string | null {
  try {
    return getStaffToolsOrigin();
  } catch {
    return null;
  }
}

function decodePart(value: string): unknown {
  if (!/^[A-Za-z0-9_-]+$/.test(value)) throw new Error("Invalid assertion encoding");
  const bytes = Buffer.from(value, "base64url");
  if (bytes.toString("base64url") !== value) throw new Error("Invalid assertion encoding");
  return JSON.parse(bytes.toString("utf8"));
}

function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

export function verifyTransitionAssertion(assertion: string, now = Math.floor(Date.now() / 1000)): TransitionIntent | null {
  try {
    if (assertion.length > 2048) return null;
    const parts = assertion.split(".");
    if (parts.length !== 3 || !/^[A-Za-z0-9_-]{86}$/.test(parts[2])) return null;
    const header = decodePart(parts[0]);
    const payload = decodePart(parts[1]);
    if (!record(header) || !record(payload) || Object.keys(header).length !== 3 ||
      header.alg !== "EdDSA" || header.typ !== "JWT" || header.kid !== "on-par-owner-ed25519-v1") return null;
    const encodedKey = getTransitionPublicKey();
    if (!/^[A-Za-z0-9+/]+={0,2}$/.test(encodedKey) || encodedKey.length > 256) return null;
    const der = Buffer.from(encodedKey, "base64");
    if (der.toString("base64") !== encodedKey) return null;
    const key = createPublicKey({ key: der, format: "der", type: "spki" });
    if (key.asymmetricKeyType !== "ed25519" || !verify(null, Buffer.from(`${parts[0]}.${parts[1]}`), key, Buffer.from(parts[2], "base64url"))) return null;
    if (payload.iss !== "on-par-staff-tools" || payload.aud !== "on-par-facilities-session-transition" ||
      payload.kind !== "facilities_session_transition_v1" || typeof payload.jti !== "string" || !UUID_V4.test(payload.jti) ||
      !Number.isSafeInteger(payload.iat) || !Number.isSafeInteger(payload.exp)) return null;
    const iat = payload.iat as number;
    const exp = payload.exp as number;
    if (iat > now + 5 || exp <= now || exp <= iat || exp - iat > 45 || now - iat > 50) return null;
    const commonKeys = ["iss", "aud", "kind", "purpose", "sub", "jti", "iat", "exp"];
    if (payload.purpose === "employee_launch" && typeof payload.sub === "string" && EMPLOYEE_ID.test(payload.sub) &&
      payload.roster_source === "shiftflow" && payload.company_id === "on-par" &&
      Object.keys(payload).every((key) => [...commonKeys, "roster_source", "company_id"].includes(key))) {
      return { purpose: "employee_launch", sub: payload.sub, roster_source: "shiftflow", company_id: "on-par", jti: payload.jti, iat, exp };
    }
    if (payload.purpose === "logout" && payload.sub === "staff-tools-logout" && Object.keys(payload).every((key) => commonKeys.includes(key))) {
      return { purpose: "logout", sub: "staff-tools-logout", jti: payload.jti, iat, exp };
    }
    return null;
  } catch {
    return null;
  }
}

export async function readFormField(request: Request, name: string, limit: number): Promise<string | null> {
  if (request.headers.get("content-type")?.split(";", 1)[0]?.trim().toLowerCase() !== "application/x-www-form-urlencoded") return null;
  const declared = request.headers.get("content-length");
  if (declared && (!/^\d+$/.test(declared) || Number(declared) > limit)) return null;
  const reader = request.body?.getReader();
  if (!reader) return null;
  let size = 0;
  const chunks: Uint8Array[] = [];
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > limit) { await reader.cancel(); return null; }
      chunks.push(value);
    }
  } catch { return null; }
  const fields = new URLSearchParams(Buffer.concat(chunks).toString("utf8"));
  return [...fields.keys()].length === 1 && fields.has(name) ? fields.get(name) : null;
}

export async function matchesEmployeeIdentity(supabase: SupabaseClient, userId: string, employeeId: string): Promise<boolean> {
  const [roster, owner, profile] = await Promise.all([
    supabase.from("staff_roster_accounts").select("employee_id, active").eq("profile_id", userId).eq("roster_source", "shiftflow").eq("company_id", "on-par").maybeSingle(),
    supabase.from("facilities_owner_accounts").select("id").eq("profile_id", userId).maybeSingle(),
    supabase.from("profiles").select("role").eq("id", userId).maybeSingle(),
  ]);
  return !roster.error && !owner.error && !profile.error && !owner.data &&
    roster.data?.active === true && roster.data.employee_id === employeeId &&
    ["staff", "manager", "admin"].includes(profile.data?.role);
}

function htmlResponse(body: string, script: string) {
  const nonce = randomBytes(18).toString("base64url");
  const styles = `
    * { box-sizing: border-box; }
    html { color-scheme: light; }
    body {
      margin: 0; min-height: 100vh; min-height: 100dvh;
      display: grid; place-items: center; padding: 24px 16px;
      background: linear-gradient(165deg, #dbeafe 0%, #ecfdf5 45%, #f4f5f7 70%);
      color: #18181b; font-family: system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      font-size: 16px; line-height: 1.6; -webkit-font-smoothing: antialiased;
    }
    main {
      width: 100%; max-width: 448px; padding: clamp(24px, 6vw, 36px);
      border: 1px solid #fff; border-radius: 24px; background: #fff;
      box-shadow: 0 16px 48px rgb(24 24 27 / 8%);
    }
    .brand { display: flex; align-items: center; gap: 12px; margin-bottom: 28px; font-weight: 650; }
    .brand-mark {
      display: grid; place-items: center; width: 40px; height: 40px;
      flex: 0 0 40px; border-radius: 12px; background: #1a73e8; color: #fff;
      font-size: 14px; font-weight: 750;
    }
    .status {
      display: inline-block; margin: 0 0 14px; padding: 4px 10px;
      border-radius: 8px; color: #1e40af; background: #eff6ff;
      font-size: 13px; line-height: 1.5; font-weight: 650;
    }
    .status-warning { color: #92400e; background: #fef3c7; }
    h1 { margin: 0 0 16px; font-size: clamp(26px, 6vw, 30px); line-height: 1.2; letter-spacing: -.025em; }
    p { margin: 0 0 24px; color: #52525b; }
    form { margin: 0; }
    .continue {
      display: flex; align-items: center; justify-content: center;
      width: 100%; min-height: 48px; padding: 12px 20px;
      border: 1px solid transparent; border-radius: 12px;
      background: #1a73e8; color: #fff; font: inherit; font-weight: 650;
      line-height: 1.5; text-align: center; text-decoration: none; cursor: pointer;
    }
    .continue:hover { background: #155fc0; }
    .continue:focus-visible { outline: 3px solid #173f89; outline-offset: 4px; }
    @media (prefers-contrast: more) {
      main { border-color: #52525b; }
      .continue { border-color: #173f89; }
    }
  `;
  return new NextResponse(`<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>On Par Facilities</title><style nonce="${nonce}">${styles}</style></head><body><main aria-labelledby="transition-title"><div class="brand"><span class="brand-mark" aria-hidden="true">OP</span><span>On Par Facilities</span></div>${body}</main><script nonce="${nonce}">${script}</script></body></html>`, {
    headers: {
      ...TRANSITION_HEADERS,
      "Content-Type": "text/html; charset=utf-8",
      "Referrer-Policy": "origin",
      "Content-Security-Policy": `default-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'; script-src 'nonce-${nonce}'; style-src 'nonce-${nonce}'`,
    },
  });
}

export function continueTransitionPage(jti: string) {
  if (!UUID_V4.test(jti)) throw new Error("Invalid transition id");
  return htmlResponse(`<span class="status">Checking sign-in</span><h1 id="transition-title">Opening Facilities</h1><p role="status">Checking this device’s Facilities sign-in…</p><form id="transition" method="post" action="/api/auth/staff-tools/complete"><input type="hidden" name="jti" value="${jti}"><button class="continue" type="submit">Continue to Facilities</button></form>`, `document.getElementById("transition").requestSubmit();`);
}

export function transitionResultPage(target: "home" | "login" | "logout", reset: boolean, unconfirmed: boolean) {
  const destination = target === "home" ? "/" : target === "login" ? "/login?reason=shared-device" : `${getShiftFlowOrigin()}/auth/onpar-logout`;
  const message = unconfirmed
    ? "This device’s Facilities sign-in was cleared. Remote session revocation could not be confirmed. Close other Facilities tabs before sharing this device."
    : reset ? "This device’s Facilities sign-in was cleared." : "Facilities is ready.";
  const heading = unconfirmed ? "Before sharing this device" : reset ? "Facilities sign-in cleared" : "You’re ready to continue";
  const status = unconfirmed ? "Sign-out needs attention" : reset ? "Device sign-in cleared" : "Sign-in checked";
  const resetScript = reset ? `try { const channel = new BroadcastChannel(${JSON.stringify(SESSION_RESET_CHANNEL)}); channel.postMessage("reset"); channel.close(); } catch {} try { localStorage.setItem(${JSON.stringify(SESSION_RESET_STORAGE_KEY)}, String(Date.now())); } catch {}` : "";
  // Keep partial failure feedback visible instead of immediately navigating away.
  return htmlResponse(`<span class="status${unconfirmed ? " status-warning" : ""}">${status}</span><h1 id="transition-title">${heading}</h1><p role="${unconfirmed ? "alert" : "status"}">${message}</p><a class="continue" href="${destination}">Continue</a>`, `${resetScript}${unconfirmed ? "" : `window.location.replace(${JSON.stringify(destination)});`}`);
}

export function transitionUnavailable(status = 400) {
  return NextResponse.json({ ok: false, error: "Facilities could not confirm the Staff Tools request. Return to Staff Tools and try again." }, { status, headers: TRANSITION_HEADERS });
}
