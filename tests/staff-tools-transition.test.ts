import { generateKeyPairSync, randomUUID, sign } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/auth/transition-session", () => ({ createTransitionSession: vi.fn() }));

import { POST as start } from "@/app/api/auth/staff-tools/start/route";
import { GET as continueGet } from "@/app/auth/staff-tools/continue/route";
import { POST as complete } from "@/app/api/auth/staff-tools/complete/route";
import { POST as signout } from "@/app/api/auth/signout/route";
import {
  INTENT_COOKIE,
  matchesEmployeeIdentity,
  trustedStaffToolsOrigin,
  verifyTransitionAssertion,
} from "@/lib/auth/staff-tools-transition";
import { BROWSER_PROFILE_COOKIE, clearBrowserSession, browserProfileAllows, supabaseCookieNames } from "@/lib/auth/browser-session";
import { createTransitionSession } from "@/lib/auth/transition-session";

const keys = generateKeyPairSync("ed25519");
const origin = "http://localhost:4401";
const staffOrigin = "http://localhost:4400";
const userId = "11111111-1111-4111-8111-111111111111";
const now = () => Math.floor(Date.now() / 1000);
const header = { alg: "EdDSA", typ: "JWT", kid: "on-par-owner-ed25519-v1" };
function payload(extra: Record<string, unknown> = {}) {
  return { iss: "on-par-staff-tools", aud: "on-par-facilities-session-transition", kind: "facilities_session_transition_v1", purpose: "employee_launch", sub: "employee-a", roster_source: "shiftflow", company_id: "on-par", jti: randomUUID(), iat: now(), exp: now() + 45, ...extra };
}
function assertion(body: Record<string, unknown> = payload(), protectedHeader = header) {
  const input = `${Buffer.from(JSON.stringify(protectedHeader)).toString("base64url")}.${Buffer.from(JSON.stringify(body)).toString("base64url")}`;
  return `${input}.${sign(null, Buffer.from(input), keys.privateKey).toString("base64url")}`;
}
function logoutPayload() {
  const body = payload({ purpose: "logout", sub: "staff-tools-logout" });
  const { roster_source: _source, company_id: _company, ...remaining } = body;
  void _source; void _company;
  return remaining;
}
function formRequest(path: string, body: Record<string, string>, requestOrigin = origin, cookies = "") {
  return new NextRequest(`${origin}${path}`, { method: "POST", headers: { origin: requestOrigin, "content-type": "application/x-www-form-urlencoded", cookie: cookies }, body: new URLSearchParams(body) });
}
function queryResult(data: unknown, error: unknown = null) {
  const query = { select: vi.fn(), eq: vi.fn(), maybeSingle: vi.fn().mockResolvedValue({ data, error }) };
  query.select.mockReturnValue(query); query.eq.mockReturnValue(query);
  return query;
}
function fakeSession() {
  const roster = queryResult({ employee_id: "employee-a", active: true });
  const owner = queryResult(null);
  const profile = queryResult({ role: "staff" });
  const value = {
    supabase: {
      from: vi.fn((table: string) => ({ staff_roster_accounts: roster, facilities_owner_accounts: owner, profiles: profile })[table]),
      auth: {
        getUser: vi.fn().mockResolvedValue({ data: { user: { id: userId } }, error: null }),
        signOut: vi.fn().mockResolvedValue({ error: null }),
      },
    },
    bounded: async <T,>(work: () => Promise<T>) => work(),
    preserveCookies: vi.fn(),
    clearCookies: vi.fn((response) => clearBrowserSession((name, value, options) => response.cookies.set(name, value, options), [{ name: "sb-synthetic-auth-token.0" }, { name: "sb-synthetic-auth-token.1" }])),
    abort: vi.fn(),
  };
  vi.mocked(createTransitionSession).mockReturnValue(value as unknown as ReturnType<typeof createTransitionSession>);
  return { ...value, roster, owner, profile };
}

beforeEach(() => {
  vi.resetAllMocks();
  vi.stubEnv("NODE_ENV", "test");
  vi.stubEnv("STAFF_TOOLS_SESSION_TRANSITION_ENABLED", "true");
  vi.stubEnv("STAFF_TOOLS_SESSION_TRANSITION_ORIGIN", staffOrigin);
  vi.stubEnv("STAFF_TOOLS_SESSION_TRANSITION_PUBLIC_KEY", keys.publicKey.export({ type: "spki", format: "der" }).toString("base64"));
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://synthetic.supabase.co");
  vi.spyOn(console, "warn").mockImplementation(() => {});
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllEnvs(); });

describe("purpose-limited signed transition", () => {
  it("accepts employee and logout assertions without granting a Facilities session", () => {
    expect(verifyTransitionAssertion(assertion())?.purpose).toBe("employee_launch");
    expect(verifyTransitionAssertion(assertion(logoutPayload()))?.purpose).toBe("logout");
  });
  it.each([
    { aud: "on-par-facilities" }, { kind: "facilities_owner_handoff" }, { role: "admin" },
    { exp: now() - 1 }, { exp: now() + 80 }, { iat: now() + 20 },
    { jti: "not-a-nonce" }, { company_id: "different-company" }, { sub: "../owner" },
    { purpose: "logout", sub: "staff-tools-logout" },
  ])("rejects incorrect or privilege-bearing claims %j", (extra) => {
    expect(verifyTransitionAssertion(assertion(payload(extra)))).toBeNull();
  });
  it("rejects forged signatures and alternate algorithms", () => {
    const token = assertion();
    expect(verifyTransitionAssertion(`${token.slice(0, -86)}${"a".repeat(86)}`)).toBeNull();
    expect(verifyTransitionAssertion(assertion(payload(), { ...header, alg: "HS256" }))).toBeNull();
  });
  it("allows loopback test origins but never HTTP production or URL paths", () => {
    expect(trustedStaffToolsOrigin()).toBe(staffOrigin);
    vi.stubEnv("NODE_ENV", "production"); expect(trustedStaffToolsOrigin()).toBeNull();
    vi.stubEnv("STAFF_TOOLS_SESSION_TRANSITION_ORIGIN", "https://on-par.vercel.app/path"); expect(trustedStaffToolsOrigin()).toBeNull();
  });
});

describe("browser-bound POST, GET, POST handshake", () => {
  it("normalizes the transition flag consistently with staging preflight", async () => {
    vi.stubEnv("STAFF_TOOLS_SESSION_TRANSITION_ENABLED", " TRUE ");
    const response = await start(formRequest("/api/auth/staff-tools/start", { assertion: assertion() }, staffOrigin));
    expect(response.status).toBe(303);
  });
  it("is disabled by default and denies untrusted origins without reading the session", async () => {
    vi.stubEnv("STAFF_TOOLS_SESSION_TRANSITION_ENABLED", "false");
    expect((await start(formRequest("/api/auth/staff-tools/start", { assertion: assertion() }, staffOrigin))).status).toBe(404);
    vi.stubEnv("STAFF_TOOLS_SESSION_TRANSITION_ENABLED", "true");
    expect((await start(formRequest("/api/auth/staff-tools/start", { assertion: assertion() }, "https://attacker.invalid"))).status).toBe(403);
    expect(createTransitionSession).not.toHaveBeenCalled();
  });
  it("sets only the intent on cross-site start; GET renders same-origin jti form", async () => {
    const body = payload(); const token = assertion(body);
    const response = await start(formRequest("/api/auth/staff-tools/start", { assertion: token }, staffOrigin));
    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe(`${origin}/auth/staff-tools/continue`);
    expect(response.cookies.getAll()).toHaveLength(1);
    expect(response.headers.get("set-cookie")).toContain("HttpOnly");
    expect(response.headers.get("set-cookie")).toContain("SameSite=lax");
    const page = await continueGet(new NextRequest(`${origin}/auth/staff-tools/continue`, { headers: { cookie: `${INTENT_COOKIE}=${token}` } }));
    const html = await page.text();
    expect(html).toContain(`name="jti" value="${body.jti}"`);
    expect(html).not.toContain(token);
    expect(createTransitionSession).not.toHaveBeenCalled();
  });
  it("rejects a missing or mismatched browser intent before authentication", async () => {
    const response = await complete(formRequest("/api/auth/staff-tools/complete", { jti: randomUUID() }));
    expect(response.status).toBe(400);
    expect(createTransitionSession).not.toHaveBeenCalled();
  });
  it("keeps the same bound active employee without undoing a newer browser binding", async () => {
    const session = fakeSession(); const body = payload();
    const response = await complete(formRequest("/api/auth/staff-tools/complete", { jti: body.jti }, origin, `${INTENT_COOKIE}=${assertion(body)}; ${BROWSER_PROFILE_COOKIE}=${userId}`));
    // A different tab may now have set 'blocked' or a new employee's UUID.
    // This delayed response must not overwrite either value.
    expect(response.cookies.get(BROWSER_PROFILE_COOKIE)).toBeUndefined();
    expect(session.supabase.auth.signOut).not.toHaveBeenCalled();
    expect(session.roster.eq).toHaveBeenCalledWith("roster_source", "shiftflow");
    expect(session.roster.eq).toHaveBeenCalledWith("company_id", "on-par");
  });
  it.each(["owner", "other-employee", "inactive", "query-error", "raced-owner-cookie", "legacy-unbound"])("clears %s instead of inheriting its privileges", async (kind) => {
    const session = fakeSession(); const body = payload();
    if (kind === "owner") session.owner.maybeSingle.mockResolvedValue({ data: { id: "owner" }, error: null });
    if (kind === "other-employee") session.roster.maybeSingle.mockResolvedValue({ data: { employee_id: "employee-b", active: true }, error: null });
    if (kind === "inactive") session.roster.maybeSingle.mockResolvedValue({ data: { employee_id: "employee-a", active: false }, error: null });
    if (kind === "query-error") session.roster.maybeSingle.mockResolvedValue({ data: null, error: "Unavailable" });
    const binding = kind === "legacy-unbound" ? "" : kind === "raced-owner-cookie" ? `; ${BROWSER_PROFILE_COOKIE}=22222222-2222-4222-8222-222222222222` : `; ${BROWSER_PROFILE_COOKIE}=${userId}`;
    const response = await complete(formRequest("/api/auth/staff-tools/complete", { jti: body.jti }, origin, `${INTENT_COOKIE}=${assertion(body)}${binding}`));
    expect(session.supabase.auth.signOut).toHaveBeenCalledWith({ scope: "local" });
    expect(response.cookies.get(BROWSER_PROFILE_COOKIE)?.value).toBe("blocked");
    expect(response.cookies.get("sb-synthetic-auth-token.1")?.maxAge).toBe(0);
    expect(await response.text()).toContain("/login?reason=shared-device");
  });
  it.each(["returns-error", "throws"])("logout clears local cookies even when remote revocation %s", async (failure) => {
    const session = fakeSession(); const body = logoutPayload();
    if (failure === "returns-error") session.supabase.auth.signOut.mockResolvedValue({ error: new Error("synthetic secret should never be logged") });
    else session.supabase.auth.signOut.mockRejectedValue(new Error("synthetic secret should never be logged"));
    const response = await complete(formRequest("/api/auth/staff-tools/complete", { jti: body.jti }, origin, `${INTENT_COOKIE}=${assertion(body)}`));
    expect(response.cookies.get(BROWSER_PROFILE_COOKIE)?.value).toBe("blocked");
    expect(response.cookies.get("sb-synthetic-auth-token.0")?.maxAge).toBe(0);
    const html = await response.text();
    expect(html).toContain("Remote session revocation could not be confirmed");
    expect(html).toContain("https://shiftflow-onpar.alexis953849.chatgpt.site/auth/onpar-logout");
    expect(html).not.toContain("window.location.replace");
    expect(JSON.stringify(vi.mocked(console.warn).mock.calls)).not.toContain("synthetic secret");
  });
  it("existing same-origin signout also clears cookies if Supabase is unavailable", async () => {
    vi.mocked(createTransitionSession).mockImplementation(() => { throw new Error("unavailable"); });
    const response = await signout(formRequest("/api/auth/signout", {}));
    expect(await response.json()).toEqual({ ok: true, remoteRevocationConfirmed: false });
    expect(response.cookies.get(BROWSER_PROFILE_COOKIE)?.value).toBe("blocked");
  });
  it("returns controlled 503 and still clears local cookies when the logout target is malformed", async () => {
    fakeSession();
    vi.stubEnv("SHIFTFLOW_ORIGIN", "not-an-origin");
    const body = logoutPayload();
    const response = await complete(formRequest("/api/auth/staff-tools/complete", { jti: body.jti }, origin, `${INTENT_COOKIE}=${assertion(body)}`));
    expect(response.status).toBe(503);
    expect(response.headers.has("location")).toBe(false);
    expect(response.cookies.get(BROWSER_PROFILE_COOKIE)?.value).toBe("blocked");
    expect(response.cookies.get("sb-synthetic-auth-token.0")?.maxAge).toBe(0);
  });
  it("reports an origin configuration conflict as unavailable before using a session", async () => {
    vi.stubEnv("STAFF_TOOLS_ORIGIN", "https://different.example.invalid");
    const response = await start(formRequest("/api/auth/staff-tools/start", { assertion: assertion() }, staffOrigin));
    expect(response.status).toBe(503);
    expect(createTransitionSession).not.toHaveBeenCalled();
  });
});

describe("cookie cleanup and identity binding", () => {
  it("removes all configured project chunks without deleting another project", () => {
    expect(supabaseCookieNames([{ name: "sb-synthetic-auth-token.7" }, { name: "sb-synthetic-auth-token-code-verifier.1" }, { name: "sb-other-auth-token.0" }, { name: "unrelated" }])).toEqual(expect.arrayContaining(["sb-synthetic-auth-token.7", "sb-synthetic-auth-token-code-verifier.1"]));
    expect(supabaseCookieNames([{ name: "sb-other-auth-token.0" }])).not.toContain("sb-other-auth-token.0");
  });
  it("allows legacy profiles but rejects old owner credentials after a new employee binding", () => {
    expect(browserProfileAllows(undefined, userId)).toBe(true);
    expect(browserProfileAllows(userId, userId)).toBe(true);
    expect(browserProfileAllows("blocked", userId)).toBe(false);
    expect(browserProfileAllows("22222222-2222-4222-8222-222222222222", userId)).toBe(false);
  });
  it("never trusts employee role claims as Facilities authorization", async () => {
    const session = fakeSession();
    session.profile.maybeSingle.mockResolvedValue({ data: { role: "pending" }, error: null });
    expect(await matchesEmployeeIdentity(session.supabase as never, userId, "employee-a")).toBe(false);
  });
});
