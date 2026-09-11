import { generateKeyPairSync } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  assertIsolatedSupabase,
  KNOWN_PRODUCTION_SUPABASE_HOSTNAME,
  ownerPublicKey,
  PRODUCTION_OWNER_PUBLIC_KEY,
  PRODUCTION_SHIFTFLOW_ORIGIN,
  PRODUCTION_STAFF_TOOLS_ORIGIN,
  shiftFlowOrigin,
  staffToolsOrigin,
  transitionPublicKey,
  validateIsolatedEnvironment,
  type FacilitiesEnvironment,
} from "../supabase/functions/_shared/environment";

vi.mock("server-only", () => ({}));

import { GET as staffTools } from "@/app/staff-tools/route";
import { GET as staffToolsOwner } from "@/app/staff-tools/owner/route";
import { loadActiveShiftFlowEmployees } from "@/lib/auth/shiftflow-punch";
import { callOwnerBroker } from "@/lib/auth/owner-sso";
import { fetchSupabase } from "@/lib/supabase/request";
import { fetchShiftFlowApi } from "@/lib/config/integrations";

const publicKey = generateKeyPairSync("ed25519").publicKey.export({ type: "spki", format: "der" }).toString("base64");
function isolatedEnv(): FacilitiesEnvironment {
  return {
    NODE_ENV: "production",
    FACILITIES_ISOLATED_STAGING: "true",
    FACILITIES_PRODUCTION_SUPABASE_HOSTNAME: "known-production.supabase.co",
    NEXT_PUBLIC_SUPABASE_URL: "https://separate-test.supabase.co",
    SUPABASE_URL: "https://separate-test.supabase.co",
    NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "synthetic-public-key",
    STAFF_TOOLS_ORIGIN: "https://staff-stage.example.invalid",
    SHIFTFLOW_ORIGIN: "https://shiftflow-stage.example.invalid",
    STAFF_TOOLS_OWNER_PUBLIC_KEY: publicKey,
  };
}
beforeEach(() => vi.stubGlobal("fetch", vi.fn()));
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe("separate staging configuration", () => {
  it("retains production defaults when isolated mode is off", () => {
    expect(staffToolsOrigin({})).toBe(PRODUCTION_STAFF_TOOLS_ORIGIN);
    expect(shiftFlowOrigin({})).toBe(PRODUCTION_SHIFTFLOW_ORIGIN);
    expect(ownerPublicKey({})).toBe(PRODUCTION_OWNER_PUBLIC_KEY);
  });
  it("accepts a complete separate web and broker environment", () => {
    expect(() => validateIsolatedEnvironment(isolatedEnv(), "web")).not.toThrow();
    expect(() => validateIsolatedEnvironment(isolatedEnv(), "broker")).not.toThrow();
    expect(transitionPublicKey(isolatedEnv())).toBe(publicKey);
  });
  it.each([
    { SHIFTFLOW_ORIGIN: undefined },
    { SHIFTFLOW_ORIGIN: PRODUCTION_SHIFTFLOW_ORIGIN },
    { SHIFTFLOW_ORIGIN: `${PRODUCTION_SHIFTFLOW_ORIGIN}.` },
    { SHIFTFLOW_ORIGIN: PRODUCTION_STAFF_TOOLS_ORIGIN },
    { STAFF_TOOLS_ORIGIN: "https://on-par-checklists.vercel.app" },
    { STAFF_TOOLS_ORIGIN: PRODUCTION_STAFF_TOOLS_ORIGIN },
    { STAFF_TOOLS_OWNER_PUBLIC_KEY: undefined },
    { STAFF_TOOLS_OWNER_PUBLIC_KEY: PRODUCTION_OWNER_PUBLIC_KEY },
    { STAFF_TOOLS_SESSION_TRANSITION_PUBLIC_KEY: PRODUCTION_OWNER_PUBLIC_KEY },
    { NEXT_PUBLIC_SUPABASE_URL: "https://known-production.supabase.co" },
    { NEXT_PUBLIC_SUPABASE_URL: "https://KNOWN-PRODUCTION.supabase.co./" },
    { FACILITIES_PRODUCTION_SUPABASE_HOSTNAME: undefined },
    { FACILITIES_PRODUCTION_SUPABASE_HOSTNAME: "https://known-production.supabase.co" },
    { STAFF_TOOLS_ORIGIN: "https://staff-stage.example.invalid/path" },
    { SHIFTFLOW_ORIGIN: "https://user:pass@example.invalid" },
    { SHIFTFLOW_ORIGIN: "http://localhost:3900" },
    { NODE_ENV: undefined, SHIFTFLOW_ORIGIN: "http://localhost:3900" },
    { NODE_ENV: "development", SHIFTFLOW_ORIGIN: "http://127.1:3900" },
  ])("rejects missing or mixed isolated settings %j", (override) => {
    expect(() => validateIsolatedEnvironment({ ...isolatedEnv(), ...override }, "web")).toThrow();
  });
  it("requires the broker's own project to differ from production", () => {
    expect(() => validateIsolatedEnvironment({ ...isolatedEnv(), SUPABASE_URL: "https://known-production.supabase.co" }, "broker")).toThrow();
  });
  it("always blocks the verified production project even if the operator supplies a different host", () => {
    expect(() => assertIsolatedSupabase(isolatedEnv(), `https://${KNOWN_PRODUCTION_SUPABASE_HOSTNAME}`)).toThrow();
  });
  it("supports the earlier origin alias but rejects ambiguous settings", () => {
    expect(staffToolsOrigin({ STAFF_TOOLS_SESSION_TRANSITION_ORIGIN: "https://stage.example.invalid" })).toBe("https://stage.example.invalid");
    expect(() => staffToolsOrigin({ STAFF_TOOLS_ORIGIN: "https://one.example.invalid", STAFF_TOOLS_SESSION_TRANSITION_ORIGIN: "https://two.example.invalid" })).toThrow();
    expect(staffToolsOrigin({ STAFF_TOOLS_ORIGIN: "https://STAGE.example.invalid/", STAFF_TOOLS_SESSION_TRANSITION_ORIGIN: "https://stage.example.invalid" })).toBe("https://stage.example.invalid");
  });
  it("normalizes isolated flags and known production hostname before checks", () => {
    expect(() => validateIsolatedEnvironment({ ...isolatedEnv(), FACILITIES_ISOLATED_STAGING: " TRUE ", SHIFTFLOW_ORIGIN: PRODUCTION_SHIFTFLOW_ORIGIN }, "web")).toThrow();
    expect(() => assertIsolatedSupabase({ ...isolatedEnv(), FACILITIES_PRODUCTION_SUPABASE_HOSTNAME: "KNOWN-PRODUCTION.SUPABASE.CO." }, "https://known-production.supabase.co")).toThrow();
  });
  it("permits loopback HTTP only for explicit nonproduction local use", () => {
    expect(shiftFlowOrigin({ ...isolatedEnv(), NODE_ENV: "development", SHIFTFLOW_ORIGIN: "http://127.0.0.1:3900" })).toBe("http://127.0.0.1:3900");
    expect(() => assertIsolatedSupabase({ ...isolatedEnv(), NODE_ENV: "development" }, "http://127.0.0.1:54321")).not.toThrow();
  });
});

describe("staging requests and navigation", () => {
  const sitesToken = "synthetic-sites-access-token";
  beforeEach(() => Object.entries({ ...isolatedEnv(), SHIFTFLOW_STAGING_API_TOKEN: sitesToken }).forEach(([name, value]) => vi.stubEnv(name, value)));
  it("uses only fixed paths on the configured Staff Tools origin", async () => {
    for (const [handler, location] of [[staffTools, "https://staff-stage.example.invalid/"], [staffToolsOwner, "https://staff-stage.example.invalid/owner/dashboard"]] as const) {
      const response = await handler();
      expect(response.headers.get("location")).toBe(location);
      expect(response.headers.has("OAI-Sites-Authorization")).toBe(false);
      expect(await response.text()).not.toContain(sitesToken);
    }
  });
  it("fails with 503 rather than returning to production on bad configuration", async () => {
    vi.stubEnv("STAFF_TOOLS_ORIGIN", PRODUCTION_STAFF_TOOLS_ORIGIN);
    const response = await staffToolsOwner();
    expect(response.status).toBe(503);
    expect(response.headers.has("location")).toBe(false);
  });
  it("requests the configured roster without following redirects", async () => {
    vi.mocked(fetch).mockResolvedValue(new Response(JSON.stringify({ ok: true, employees: [{ id: "synthetic", displayName: "Test Employee", departmentNames: [] }] })));
    const employees = await loadActiveShiftFlowEmployees();
    expect(fetch).toHaveBeenCalledWith("https://shiftflow-stage.example.invalid/api/shiftflow", expect.objectContaining({ redirect: "error" }));
    expect(new Headers(vi.mocked(fetch).mock.calls[0][1]?.headers).get("OAI-Sites-Authorization")).toBe(`Bearer ${sitesToken}`);
    expect(JSON.stringify(employees)).not.toContain(sitesToken);
  });
  it.each([undefined, "false", "1"])("never sends the token without the explicit isolated flag (%s)", async (flag) => {
    vi.stubEnv("FACILITIES_ISOLATED_STAGING", flag);
    vi.stubEnv("SHIFTFLOW_ORIGIN", undefined);
    vi.mocked(fetch).mockResolvedValue(new Response("{}"));
    await fetchShiftFlowApi({ headers: { "oai-sites-authorization": "Bearer caller-supplied" }, redirect: "follow" });
    const [url, options] = vi.mocked(fetch).mock.calls[0];
    expect(url).toBe(`${PRODUCTION_SHIFTFLOW_ORIGIN}/api/shiftflow`);
    expect(options?.redirect).toBe("error");
    expect(new Headers(options?.headers).has("OAI-Sites-Authorization")).toBe(false);
  });
  it("supports staging without a platform token and discards caller-supplied access headers", async () => {
    vi.stubEnv("SHIFTFLOW_STAGING_API_TOKEN", undefined);
    vi.mocked(fetch).mockResolvedValue(new Response("{}"));
    await fetchShiftFlowApi({ headers: { "OAI-Sites-Authorization": "Bearer caller-supplied" } });
    expect(new Headers(vi.mocked(fetch).mock.calls[0][1]?.headers).has("OAI-Sites-Authorization")).toBe(false);
  });
  it.each([
    "https://other-project.supabase.co",
    "https://OTHER-PROJECT.supabase.co./",
    "https://other-project.supabase.in",
    "https://api.supabase.com",
    "https://custom-database.example.invalid",
    "https://custom-broker.example.invalid",
    PRODUCTION_SHIFTFLOW_ORIGIN,
    "http://127.0.0.1:3900",
  ])("blocks private staging credentials to unsafe targets: %s", async (origin) => {
    vi.stubEnv("SHIFTFLOW_ORIGIN", origin);
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://custom-database.example.invalid");
    vi.stubEnv("SUPABASE_URL", "https://custom-broker.example.invalid");
    vi.stubEnv("NODE_ENV", "test");
    await expect(loadActiveShiftFlowEmployees()).rejects.toMatchObject({ code: "roster_unavailable" });
    expect(fetch).not.toHaveBeenCalled();
  });
  it("does not disclose malformed tokens or make a request with them", async () => {
    vi.stubEnv("SHIFTFLOW_STAGING_API_TOKEN", `${sitesToken}\r\nx-injected: true`);
    expect(() => fetchShiftFlowApi()).toThrow("Facilities configuration is invalid: SHIFTFLOW_STAGING_API_TOKEN");
    expect(fetch).not.toHaveBeenCalled();
  });
  it("forces redirect rejection even if the caller requests following, with no retry", async () => {
    vi.mocked(fetch).mockRejectedValue(new TypeError("redirect encountered"));
    await expect(fetchShiftFlowApi({ redirect: "follow" })).rejects.toThrow("redirect encountered");
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(vi.mocked(fetch).mock.calls[0][1]?.redirect).toBe("error");
  });
  it("sends owner assertions only to the configured Supabase broker without redirects", async () => {
    vi.mocked(fetch).mockResolvedValue(new Response(JSON.stringify({ ok: false })));
    await callOwnerBroker({ action: "owner_handoff_create", assertion: "synthetic-assertion" });
    expect(fetch).toHaveBeenCalledWith("https://separate-test.supabase.co/functions/v1/facilities-auth", expect.objectContaining({ redirect: "error", method: "POST" }));
    expect(new Headers(vi.mocked(fetch).mock.calls[0][1]?.headers).has("OAI-Sites-Authorization")).toBe(false);
    expect(vi.mocked(fetch).mock.calls[0][1]?.body).not.toContain(sitesToken);
  });
  it("forces authenticated Supabase fetches to reject redirects", async () => {
    vi.mocked(fetch).mockResolvedValue(new Response("{}"));
    await fetchSupabase("https://separate-test.supabase.co/auth/v1/user", { redirect: "follow" });
    expect(fetch).toHaveBeenCalledWith(expect.any(String), { redirect: "error" });
  });
  it("makes no network request when the configured Supabase project is production", async () => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://known-production.supabase.co");
    await expect(callOwnerBroker({ action: "owner_handoff_create", assertion: "synthetic-assertion" })).rejects.toThrow();
    expect(fetch).not.toHaveBeenCalled();
  });
});
