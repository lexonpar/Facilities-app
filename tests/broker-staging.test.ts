import { createHash, generateKeyPairSync, randomUUID, sign } from "node:crypto";
import { beforeEach, afterEach, afterAll, describe, expect, it, vi } from "vitest";

vi.mock("@supabase/supabase-js", () => ({ createClient: vi.fn() }));
import { createClient } from "@supabase/supabase-js";

const keys = generateKeyPairSync("ed25519");
let env: Record<string, string | undefined> = {};
let handler: (request: Request) => Response | Promise<Response>;
vi.stubGlobal("Deno", {
  env: { get: (name: string) => env[name] },
  serve: (callback: typeof handler) => { handler = callback; },
});
// The function is executed with synthetic Deno globals and mocked network/DB.
// Keep Deno's .ts entrypoint outside the website's TypeScript module graph.
const functionPath = "../supabase/functions/" + "facilities-auth/index.ts";
const brokerModule = await import(functionPath) as {
  facilitiesRoleForNewShiftFlowProfile(
    role: "employee" | "manager" | "admin",
  ): "staff" | "manager";
};

beforeEach(() => {
  vi.clearAllMocks();
  env = {
    FACILITIES_ISOLATED_STAGING: "true",
    FACILITIES_PRODUCTION_SUPABASE_HOSTNAME: "known-production.supabase.co",
    SUPABASE_URL: "https://separate-test.supabase.co",
    SUPABASE_SERVICE_ROLE_KEY: "synthetic-server-key",
    SUPABASE_ANON_KEY: "synthetic-public-key",
    SHIFTFLOW_ORIGIN: "https://shiftflow-stage.example.invalid",
    SHIFTFLOW_STAGING_API_TOKEN: "synthetic-sites-access-token",
    STAFF_TOOLS_OWNER_PUBLIC_KEY: keys.publicKey.export({ type: "spki", format: "der" }).toString("base64"),
  };
  vi.stubGlobal("fetch", vi.fn());
});
afterEach(() => vi.restoreAllMocks());
afterAll(() => vi.unstubAllGlobals());

function request(body: Record<string, unknown>) {
  return new Request("https://separate-test.supabase.co/functions/v1/facilities-auth", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
}

function queryResult(data: unknown, error: unknown = null) {
  const query: Record<string, unknown> = { data, error };
  for (const method of ["select", "eq", "is", "gt", "lt", "delete", "update", "insert"]) {
    query[method] = vi.fn().mockReturnValue(query);
  }
  query.maybeSingle = vi.fn().mockResolvedValue({ data, error });
  query.single = vi.fn().mockResolvedValue({ data, error });
  return query as Record<string, ReturnType<typeof vi.fn>> & {
    data: unknown;
    error: unknown;
  };
}

const employeeId = "synthetic-employee";
const profileId = "11111111-1111-4111-8111-111111111111";

function employeeRemovalAssertion(audience = "ope-facilities-employee-removal") {
  const now = Math.floor(Date.now() / 1000);
  const header = { alg: "EdDSA", typ: "JWT", kid: "employee-removal-v1" };
  const claims = { iss: "staff-tools-employee-access", aud: audience, kind: "employee_removal",
    sub: employeeId, sevenShiftsEmployeeId: "990000001", authVersion: 5, active: false,
    jti: randomUUID(), iat: now, exp: now + 45 };
  const input = `${Buffer.from(JSON.stringify(header)).toString("base64url")}.${Buffer.from(JSON.stringify(claims)).toString("base64url")}`;
  return `${input}.${sign(null, Buffer.from(input), keys.privateKey).toString("base64url")}`;
}

describe("staging employee removal", () => {
  it("updates only the exact employee roster mapping after assertion verification", async () => {
    env.EMPLOYEE_REMOVAL_ENABLED = "true";
    env.EMPLOYEE_REMOVAL_PUBLIC_KEY = keys.publicKey.export({ type: "spki", format: "pem" }).toString();
    const query = queryResult([{ profile_id: profileId }]);
    const from = vi.fn(() => query);
    vi.mocked(createClient).mockReturnValue({ from } as never);
    const response = await handler(request({ action: "employee_removal", assertion: employeeRemovalAssertion() }));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true, changed: 1 });
    expect(from).toHaveBeenCalledExactlyOnceWith("staff_roster_accounts");
    expect(query.update).toHaveBeenCalledExactlyOnceWith({ active: false });
    expect(query.eq.mock.calls).toEqual([["roster_source", "shiftflow"], ["company_id", "on-par"], ["employee_id", employeeId], ["active", true]]);
    expect(fetch).not.toHaveBeenCalled();
  });
  it("rejects a Training assertion without opening the database", async () => {
    env.EMPLOYEE_REMOVAL_ENABLED = "true";
    env.EMPLOYEE_REMOVAL_PUBLIC_KEY = keys.publicKey.export({ type: "spki", format: "pem" }).toString();
    expect((await handler(request({ action: "employee_removal", assertion: employeeRemovalAssertion("ope-training-employee-removal") }))).status).toBe(401);
    expect(createClient).not.toHaveBeenCalled();
  });
  it("disabled removal cannot change employee access", async () => {
    expect((await handler(request({ action: "employee_removal", assertion: employeeRemovalAssertion() }))).status).toBe(404);
    expect(createClient).not.toHaveBeenCalled();
  });
  it("returns failure when the access update cannot be saved", async () => {
    env.EMPLOYEE_REMOVAL_ENABLED = "true";
    env.EMPLOYEE_REMOVAL_PUBLIC_KEY = keys.publicKey.export({ type: "spki", format: "pem" }).toString();
    vi.mocked(createClient).mockReturnValue({ from: () => queryResult(null, { message: "synthetic failure" }) } as never);
    const response = await handler(request({ action: "employee_removal", assertion: employeeRemovalAssertion() }));
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ ok: false, error: "Employee removal unavailable" });
  });
});

function profileRow(role: "pending" | "staff" | "manager" | "admin") {
  return {
    id: profileId,
    email: "manually-linked@example.invalid",
    username: "manually_linked",
    display_name: "Test Employee",
    role,
  };
}

function sessionClients(admin: Record<string, unknown>) {
  const generateLink = vi.fn().mockResolvedValue({
    data: {
      user: { id: profileId },
      properties: { hashed_token: "synthetic-one-time-token" },
    },
    error: null,
  });
  const verifyOtp = vi.fn().mockResolvedValue({
    data: {
      user: { id: profileId },
      session: {
        user: { id: profileId },
        access_token: "synthetic-access-token",
        refresh_token: "synthetic-refresh-token",
      },
    },
    error: null,
  });
  const adminClient = {
    ...admin,
    auth: {
      admin: {
        createUser: vi.fn(),
        updateUserById: vi.fn().mockResolvedValue({ error: null }),
        generateLink,
      },
    },
  };
  const publicClient = { auth: { verifyOtp } };
  vi.mocked(createClient)
    .mockReturnValueOnce(adminClient as never)
    .mockReturnValueOnce(publicClient as never);
  return { adminClient, generateLink, verifyOtp };
}

function mappedProfileDatabase(
  currentRole: "pending" | "staff" | "manager" | "admin",
  promotedRole: "manager" | null,
) {
  const roster = { profile_id: profileId, active: true };
  const rosterQueries = [
    queryResult(roster),
    queryResult(roster),
    queryResult(null),
  ];
  const profileQueries = [queryResult(profileRow(currentRole))];
  const promotionQuery = promotedRole
    ? queryResult(profileRow(promotedRole))
    : null;
  if (promotionQuery) profileQueries.push(promotionQuery);
  const from = vi.fn((table: string) => {
    const next = table === "staff_roster_accounts"
      ? rosterQueries.shift()
      : table === "profiles"
      ? profileQueries.shift()
      : undefined;
    if (!next) throw new Error(`Unexpected ${table} query`);
    return next;
  });
  sessionClients({ from });
  return { from, promotionQuery };
}

function verifiedPunchResponse(role: unknown) {
  return new Response(JSON.stringify({
    ok: true,
    authenticated: true,
    user: { id: employeeId, displayName: "Test Employee", role },
  }));
}

describe("actual Edge handler with isolated services", () => {
  it("rejects a mixed project before any network or database request", async () => {
    env.SUPABASE_URL = "https://known-production.supabase.co";
    const response = await handler(request({ action: "login", employeeId: "synthetic-employee", punchId: "0000" }));
    expect(response.status).toBe(503);
    expect(fetch).not.toHaveBeenCalled();
    expect(createClient).not.toHaveBeenCalled();
  });

  it("sends Punch verification and temporary logout only to the staging ShiftFlow origin", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(new Response(JSON.stringify({ code: "invalid_login" }), { status: 401, headers: { "set-cookie": `shiftflow_session=${"a".repeat(64)}; Path=/` } }));
    vi.mocked(fetch).mockResolvedValueOnce(new Response("{}"));
    const response = await handler(request({ action: "login", employeeId: "synthetic-employee", punchId: "0000" }));
    expect(response.status).toBe(401);
    expect(fetch).toHaveBeenCalledTimes(2);
    for (const [url, options] of vi.mocked(fetch).mock.calls) {
      expect(url).toBe("https://shiftflow-stage.example.invalid/api/shiftflow");
      expect(options?.redirect).toBe("error");
      expect(new Headers(options?.headers).get("Origin")).toBe("https://shiftflow-stage.example.invalid");
      expect(new Headers(options?.headers).get("OAI-Sites-Authorization")).toBe("Bearer synthetic-sites-access-token");
    }
    expect(new Headers(vi.mocked(fetch).mock.calls[0][1]?.headers).has("Cookie")).toBe(false);
    expect(new Headers(vi.mocked(fetch).mock.calls[1][1]?.headers).get("Cookie")).toBe(`shiftflow_session=${"a".repeat(64)}`);
    expect(await response.text()).not.toContain("synthetic-sites-access-token");
    expect(createClient).not.toHaveBeenCalled();
  });

  it("ignores a configured Sites token when the broker is outside isolated staging", async () => {
    env.FACILITIES_ISOLATED_STAGING = "false";
    delete env.SHIFTFLOW_ORIGIN;
    vi.mocked(fetch).mockResolvedValue(new Response(JSON.stringify({ code: "invalid_login" }), { status: 401 }));
    const response = await handler(request({ action: "login", employeeId, punchId: "0000" }));
    expect(response.status).toBe(401);
    const [url, options] = vi.mocked(fetch).mock.calls[0];
    expect(url).toBe("https://shiftflow-onpar.alexis953849.chatgpt.site/api/shiftflow");
    expect(new Headers(options?.headers).has("OAI-Sites-Authorization")).toBe(false);
  });

  it.each(["https://other-project.supabase.co", "https://separate-test.supabase.co", "https://custom-database.example.invalid"])(
    "rejects private staging requests directed to Supabase (%s) before login or provisioning",
    async (origin) => {
      env.SHIFTFLOW_ORIGIN = origin;
      env.SUPABASE_URL = "https://custom-database.example.invalid";
      const response = await handler(request({ action: "login", employeeId, punchId: "0000" }));
      expect(response.status).toBe(503);
      expect(await response.text()).not.toContain("synthetic-sites-access-token");
      expect(fetch).not.toHaveBeenCalled();
      expect(createClient).not.toHaveBeenCalled();
    },
  );

  it("fails closed when the private staging API redirects, without retrying or creating an account", async () => {
    vi.mocked(fetch).mockRejectedValue(new TypeError("redirect encountered"));
    const response = await handler(request({ action: "login", employeeId, punchId: "0000" }));
    expect(response.status).toBe(503);
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(vi.mocked(fetch).mock.calls[0][1]?.redirect).toBe("error");
    expect(createClient).not.toHaveBeenCalled();
  });

  it("verifies the separate owner public key before storing only hashed ticket identifiers", async () => {
    const insert = vi.fn().mockResolvedValue({ error: null });
    const lt = vi.fn().mockResolvedValue({ error: null });
    const database = { from: vi.fn(() => ({ insert, delete: () => ({ lt }) })) };
    vi.mocked(createClient).mockReturnValue(database as never);
    const now = Math.floor(Date.now() / 1000);
    const header = { alg: "EdDSA", typ: "JWT", kid: "on-par-owner-ed25519-v1" };
    const claims = { iss: "on-par-staff-tools", aud: "on-par-facilities", kind: "facilities_owner_handoff", sub: "emp-alexis-younker", owner_name: "Alexis Younker", jti: randomUUID(), iat: now, exp: now + 45 };
    const input = `${Buffer.from(JSON.stringify(header)).toString("base64url")}.${Buffer.from(JSON.stringify(claims)).toString("base64url")}`;
    const assertion = `${input}.${sign(null, Buffer.from(input), keys.privateKey).toString("base64url")}`;
    const response = await handler(request({ action: "owner_handoff_create", assertion }));
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.ok).toBe(true);
    expect(body.ticket).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(insert.mock.calls[0][0]).toMatchObject({ assertion_jti_hash: expect.stringMatching(/^[a-f0-9]{64}$/), ticket_hash: expect.stringMatching(/^[a-f0-9]{64}$/) });
    expect(JSON.stringify(insert.mock.calls)).not.toContain(claims.jti);
    expect(JSON.stringify(insert.mock.calls)).not.toContain(body.ticket);
    expect(createClient).toHaveBeenCalledWith("https://separate-test.supabase.co", "synthetic-server-key", expect.objectContaining({ global: { fetch: expect.any(Function) } }));
    expect(fetch).not.toHaveBeenCalled();
    // Exercise the actual Supabase client's injected fetch with the Sites token
    // configured, proving it is not a global outbound credential.
    const supabaseFetch = vi.mocked(createClient).mock.calls[0][2]?.global?.fetch;
    expect(supabaseFetch).toBeTypeOf("function");
    vi.mocked(fetch).mockResolvedValue(new Response("{}"));
    await supabaseFetch!("https://separate-test.supabase.co/auth/v1/user", { redirect: "follow" });
    const [, options] = vi.mocked(fetch).mock.calls[0];
    expect(options?.redirect).toBe("error");
    expect(new Headers(options?.headers).has("OAI-Sites-Authorization")).toBe(false);
  });

  it.each([undefined, null, "leadership", "Manager"])(
    "rejects an authenticated ShiftFlow response with invalid system role %s",
    async (role) => {
      vi.mocked(fetch).mockResolvedValue(verifiedPunchResponse(role));
      const response = await handler(request({
        action: "login",
        employeeId,
        punchId: "1234",
      }));
      expect(response.status).toBe(503);
      expect(await response.json()).toMatchObject({
        ok: false,
        code: "login_unavailable",
      });
      expect(createClient).not.toHaveBeenCalled();
    },
  );

  it.each([
    { currentRole: "pending" as const, shiftFlowRole: "manager" as const },
    { currentRole: "staff" as const, shiftFlowRole: "manager" as const },
    { currentRole: "staff" as const, shiftFlowRole: "admin" as const },
  ])(
    "promotes a mapped Facilities $currentRole profile for a verified ShiftFlow $shiftFlowRole without granting Facilities admin",
    async ({ currentRole, shiftFlowRole }) => {
      const { promotionQuery } = mappedProfileDatabase(currentRole, "manager");
      vi.mocked(fetch).mockResolvedValue(verifiedPunchResponse(shiftFlowRole));

      const response = await handler(request({
        action: "login",
        employeeId,
        punchId: "1234",
      }));

      expect(response.status).toBe(200);
      expect(await response.json()).toMatchObject({ ok: true, role: "manager" });
      expect(promotionQuery?.update).toHaveBeenCalledWith({ role: "manager" });
      expect(promotionQuery?.eq).toHaveBeenCalledWith("role", currentRole);
      expect(promotionQuery?.update).not.toHaveBeenCalledWith({ role: "admin" });
    },
  );

  it.each([
    { shiftFlowRole: "employee" as const, facilitiesRole: "manager" as const },
    { shiftFlowRole: "admin" as const, facilitiesRole: "manager" as const },
    { shiftFlowRole: "manager" as const, facilitiesRole: "admin" as const },
  ])(
    "preserves an existing Facilities $facilitiesRole role for a ShiftFlow $shiftFlowRole",
    async ({ shiftFlowRole, facilitiesRole }) => {
      const { from } = mappedProfileDatabase(facilitiesRole, null);
      vi.mocked(fetch).mockResolvedValue(verifiedPunchResponse(shiftFlowRole));

      const response = await handler(request({
        action: "login",
        employeeId,
        punchId: "1234",
      }));

      expect(response.status).toBe(200);
      expect(await response.json()).toMatchObject({ role: facilitiesRole });
      const profileCalls = from.mock.calls.filter(([table]) => table === "profiles");
      expect(profileCalls).toHaveLength(1);
    },
  );

  it("ignores client privilege claims and department labels when ShiftFlow verifies an employee role", async () => {
    const { from } = mappedProfileDatabase("staff", null);
    vi.mocked(fetch).mockResolvedValue(new Response(JSON.stringify({
      ok: true,
      authenticated: true,
      user: {
        id: employeeId,
        displayName: "Test Employee",
        role: "employee",
        departmentNames: ["Leadership"],
      },
    })));

    const response = await handler(request({
      action: "login",
      employeeId,
      punchId: "1234",
      role: "admin",
      departmentNames: ["Leadership"],
    }));

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ role: "staff" });
    const profileCalls = from.mock.calls.filter(([table]) => table === "profiles");
    expect(profileCalls).toHaveLength(1);
  });

  it("maps new ShiftFlow manager and admin profiles to Facilities manager only", () => {
    expect(brokerModule.facilitiesRoleForNewShiftFlowProfile("employee")).toBe("staff");
    expect(brokerModule.facilitiesRoleForNewShiftFlowProfile("manager")).toBe("manager");
    expect(brokerModule.facilitiesRoleForNewShiftFlowProfile("admin")).toBe("manager");
  });

  it.each(["manager", "admin"] as const)(
    "creates a new verified ShiftFlow %s profile as Facilities manager",
    async (shiftFlowRole) => {
      const identityDigest = createHash("sha256")
        .update(`facilities-shiftflow-account-v1:${employeeId}`)
        .digest("hex");
      const newProfile = {
        id: profileId,
        email: `shiftflow-${identityDigest.slice(0, 32)}@auth.onpar.invalid`,
        username: `shiftflow_${identityDigest.slice(0, 24)}`,
        display_name: "Test Employee",
        role: "manager",
      };
      const profileInsert = queryResult(newProfile);
      const profileQueries = [
        queryResult(null),
        queryResult(null),
        queryResult(null),
        profileInsert,
        queryResult(newProfile),
      ];
      const rosterQueries = [
        queryResult(null),
        queryResult(null),
        queryResult({ profile_id: profileId, active: true }),
        queryResult(null),
      ];
      const from = vi.fn((table: string) => {
        const next = table === "profiles"
          ? profileQueries.shift()
          : table === "staff_roster_accounts"
          ? rosterQueries.shift()
          : undefined;
        if (!next) throw new Error(`Unexpected ${table} query`);
        return next;
      });
      const { adminClient } = sessionClients({ from });
      vi.mocked(adminClient.auth.admin.createUser).mockResolvedValue({
        data: { user: { id: profileId } },
        error: null,
      } as never);
      vi.mocked(fetch).mockResolvedValue(verifiedPunchResponse(shiftFlowRole));

      const response = await handler(request({
        action: "login",
        employeeId,
        punchId: "1234",
      }));

      expect(response.status).toBe(200);
      expect(await response.json()).toMatchObject({ role: "manager" });
      expect(profileInsert.insert).toHaveBeenCalledWith(expect.objectContaining({
        role: "manager",
      }));
      expect(profileInsert.insert).not.toHaveBeenCalledWith(expect.objectContaining({
        role: "admin",
      }));
    },
  );
});
