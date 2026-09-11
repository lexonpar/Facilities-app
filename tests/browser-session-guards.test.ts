import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { NextRequest, NextResponse } from "next/server";

vi.mock("server-only", () => ({}));
vi.mock("next/headers", () => ({ cookies: vi.fn() }));
vi.mock("@/lib/supabase/middleware", () => ({ createMiddlewareSupabase: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn() }));
vi.mock("@/lib/auth/profile", () => ({ loadProfileByUserId: vi.fn() }));
vi.mock("@/lib/auth/session", () => ({ getFacilitiesAccess: vi.fn() }));

import { cookies } from "next/headers";
import { proxy } from "@/proxy";
import { getAuthContext } from "@/lib/auth/server";
import { BROWSER_PROFILE_COOKIE } from "@/lib/auth/browser-session";
import { createMiddlewareSupabase } from "@/lib/supabase/middleware";
import { createClient } from "@/lib/supabase/server";
import { loadProfileByUserId } from "@/lib/auth/profile";

const employeeProfile = "11111111-1111-4111-8111-111111111111";
const ownerProfile = "22222222-2222-4222-8222-222222222222";
beforeEach(() => {
  vi.resetAllMocks();
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://synthetic.supabase.co");
});
afterEach(() => vi.unstubAllEnvs());

describe("durable browser profile guard", () => {
  it.each(["/api/auth/staff-tools/start", "/auth/staff-tools/continue", "/api/auth/staff-tools/complete", "/api/auth/punch/login", "/api/auth/owner/handoff", "/api/auth/signout"])("does not refresh the previous profile before %s", async (path) => {
    await proxy(new NextRequest(`https://facilities.invalid${path}`));
    expect(createMiddlewareSupabase).not.toHaveBeenCalled();
  });

  it("blocks a cleared browser before calling Supabase and deletes a raced refresh cookie", async () => {
    const request = new NextRequest("https://facilities.invalid/lead", { headers: { cookie: `${BROWSER_PROFILE_COOKIE}=blocked; sb-synthetic-auth-token.0=raced` } });
    const response = await proxy(request);
    expect(createMiddlewareSupabase).not.toHaveBeenCalled();
    expect(response.headers.get("location")).toBe("https://facilities.invalid/login?reason=shared-device");
    expect(response.cookies.get("sb-synthetic-auth-token.0")?.maxAge).toBe(0);
  });

  it("rejects a late owner refresh after successful employee sign-in", async () => {
    const refreshResponse = NextResponse.next();
    refreshResponse.cookies.set("sb-synthetic-auth-token.1", "late-owner-token");
    const getUser = vi.fn().mockResolvedValue({ data: { user: { id: ownerProfile } } });
    vi.mocked(createMiddlewareSupabase).mockReturnValue({ supabase: { auth: { getUser } }, getResponse: () => refreshResponse } as never);
    const response = await proxy(new NextRequest("https://facilities.invalid/admin/team", { headers: { cookie: `${BROWSER_PROFILE_COOKIE}=${employeeProfile}; sb-synthetic-auth-token.0=old` } }));
    expect(response.cookies.get(BROWSER_PROFILE_COOKIE)?.value).toBe("blocked");
    expect(response.cookies.get("sb-synthetic-auth-token.1")?.maxAge).toBe(0);
    expect(response.headers.get("location")).toContain("/login?reason=shared-device");
  });

  it("secure API helper refuses a blocked browser without any auth or database request", async () => {
    vi.mocked(cookies).mockResolvedValue({ get: () => ({ value: "blocked" }) } as never);
    expect(await getAuthContext()).toBeNull();
    expect(createClient).not.toHaveBeenCalled();
  });

  it("secure API helper refuses an owner token with an employee binding before loading privileged data", async () => {
    vi.mocked(cookies).mockResolvedValue({ get: () => ({ value: employeeProfile }) } as never);
    vi.mocked(createClient).mockResolvedValue({ auth: { getUser: async () => ({ data: { user: { id: ownerProfile, email: "synthetic@example.invalid" } }, error: null }) } } as never);
    expect(await getAuthContext()).toBeNull();
    expect(loadProfileByUserId).not.toHaveBeenCalled();
  });
});
