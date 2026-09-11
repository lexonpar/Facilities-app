import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { NextRequest, NextResponse } from "next/server";

vi.mock("server-only", () => ({}));
vi.mock("@supabase/ssr", () => ({ createServerClient: vi.fn(() => ({})) }));

import { createServerClient } from "@supabase/ssr";
import { createTransitionSession } from "@/lib/auth/transition-session";

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://synthetic.supabase.co");
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", "synthetic-public-key");
});
afterEach(() => { vi.useRealTimers(); vi.unstubAllEnvs(); });

describe("bounded Supabase cleanup", () => {
  it("caps the entire session operation even if the client keeps retrying", async () => {
    vi.useFakeTimers();
    const session = createTransitionSession(new NextRequest("https://facilities.invalid/api/auth/signout"));
    const operation = session.bounded(() => new Promise<never>(() => {}));
    const rejection = expect(operation).rejects.toThrow("timed out");
    await vi.advanceTimersByTimeAsync(8000);
    await rejection;
  });

  it("expires both incoming and newly refreshed chunks and discards later writes", () => {
    const session = createTransitionSession(new NextRequest("https://facilities.invalid/api/auth/signout", { headers: { cookie: "sb-synthetic-auth-token.0=old" } }));
    const options = vi.mocked(createServerClient).mock.calls[0][2];
    const setAll = options.cookies.setAll;
    if (!setAll) throw new Error("Expected route cookie adapter");
    void setAll([{ name: "sb-synthetic-auth-token.1", value: "raced-refresh", options: { path: "/" } }], {});
    const response = NextResponse.json({ ok: true });
    session.clearCookies(response);
    void setAll([{ name: "sb-synthetic-auth-token.0", value: "late-refresh-after-cleanup", options: { path: "/" } }], {});
    expect(response.cookies.get("sb-synthetic-auth-token.0")?.value).toBe("");
    expect(response.cookies.get("sb-synthetic-auth-token.1")?.maxAge).toBe(0);
    expect(response.cookies.get("facilities_browser_profile")?.value).toBe("blocked");
  });
});
