import {
  createClient,
  type SupabaseClient,
} from "@supabase/supabase-js";
import { jwtVerify } from "jose";
import {
  ownerPublicKey,
  shiftFlowOrigin,
  validateIsolatedEnvironment,
} from "../_shared/environment.ts";
import { fetchValidatedShiftFlowApi } from "../_shared/shiftflow-request.ts";
import { verifyEmployeeRemoval } from "../_shared/employee-removal-protocol.ts";

declare const Deno: {
  env: { get(name: string): string | undefined };
  serve(handler: (request: Request) => Response | Promise<Response>): void;
};

const SHIFTFLOW_SESSION_COOKIE = "shiftflow_session";
const ROSTER_SOURCE = "shiftflow";
const ROSTER_COMPANY_ID = "on-par";
const OWNER_ID = "emp-alexis-younker";
const OWNER_DISPLAY_NAME = "Alexis Younker";
const OWNER_ASSERTION_ISSUER = "on-par-staff-tools";
const OWNER_ASSERTION_AUDIENCE = "on-par-facilities";
const OWNER_ASSERTION_KIND = "facilities_owner_handoff";
const OWNER_ASSERTION_KEY_ID = "on-par-owner-ed25519-v1";
const OWNER_TICKET_SECONDS = 60;
const OWNER_IDENTITY: FacilitiesIdentity = {
  email: "staff-tools-owner-alexis@auth.onpar.invalid",
  username: "owner_alexis_younker",
};
const MAX_BODY_BYTES = 4_096;
const MAX_UPSTREAM_RESPONSE_BYTES = 4_000_000;
const UPSTREAM_TIMEOUT_MS = 12_000;
const SUPABASE_PASSWORD_MAX_LENGTH = 72;
const THROWAWAY_PASSWORD_RANDOM_BYTES = 32;
const THROWAWAY_PASSWORD_SUFFIX = "Aa1!";
const NO_STORE_HEADERS = {
  "Cache-Control": "private, no-store",
  "Content-Type": "application/json; charset=utf-8",
};

function brokerEnvironment() {
  return {
    FACILITIES_ISOLATED_STAGING: Deno.env.get("FACILITIES_ISOLATED_STAGING"),
    FACILITIES_PRODUCTION_SUPABASE_HOSTNAME: Deno.env.get("FACILITIES_PRODUCTION_SUPABASE_HOSTNAME"),
    SHIFTFLOW_ORIGIN: Deno.env.get("SHIFTFLOW_ORIGIN"),
    SHIFTFLOW_STAGING_API_TOKEN: Deno.env.get("SHIFTFLOW_STAGING_API_TOKEN"),
    STAFF_TOOLS_OWNER_PUBLIC_KEY: Deno.env.get("STAFF_TOOLS_OWNER_PUBLIC_KEY"),
    SUPABASE_URL: Deno.env.get("SUPABASE_URL"),
    // Hosted Edge Functions enforce HTTPS; local serving can explicitly opt in.
    NODE_ENV: Deno.env.get("NODE_ENV") || "production",
  };
}

type UserRole = "pending" | "staff" | "manager" | "admin";
type ShiftFlowRole = "employee" | "manager" | "admin";

type BrokerBody = {
  action?: unknown;
  employeeId?: unknown;
  punchId?: unknown;
  assertion?: unknown;
  ticket?: unknown;
};

type VerifiedEmployee = {
  id: string;
  displayName: string;
  role: ShiftFlowRole;
};

type FacilitiesIdentity = {
  email: string;
  username: string;
};

type FacilitiesProfile = FacilitiesIdentity & {
  id: string;
  displayName: string | null;
  role: UserRole;
};

type RosterAccount = {
  profileId: string | null;
  active: boolean;
};

type OwnerAccount = {
  profileId: string;
  active: boolean;
};

class FacilitiesAuthError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly retryAfter: string | null = null,
  ) {
    super(message);
    this.name = "FacilitiesAuthError";
  }
}

function jsonResponse(
  status: number,
  body: Record<string, unknown>,
  retryAfter: string | null = null,
) {
  const headers = new Headers(NO_STORE_HEADERS);
  if (retryAfter && /^\d{1,6}$/.test(retryAfter)) {
    headers.set("Retry-After", retryAfter);
  }
  return new Response(JSON.stringify(body), { status, headers });
}

function asObject(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function normalizedText(value: unknown, maxLength: number): string {
  if (typeof value !== "string") return "";
  return value
    .normalize("NFKC")
    .replace(/[\u0000-\u001f\u007f-\u009f]/g, "")
    .trim()
    .replace(/\s+/g, " ")
    .slice(0, maxLength);
}

function isShiftFlowRole(value: unknown): value is ShiftFlowRole {
  return value === "employee" || value === "manager" || value === "admin";
}

export function facilitiesRoleForNewShiftFlowProfile(
  role: ShiftFlowRole,
): Extract<UserRole, "staff" | "manager"> {
  // A ShiftFlow admin is a Facilities manager, never a Facilities admin.
  return role === "employee" ? "staff" : "manager";
}

function base64Bytes(value: string) {
  const binary = atob(value);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

function base64Url(bytes: Uint8Array) {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary)
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

async function sha256Hex(value: string) {
  const bytes = new Uint8Array(
    await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value)),
  );
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

let ownerVerificationKeyPromise: Promise<CryptoKey> | null = null;
let ownerVerificationKeyValue = "";

function ownerVerificationKey() {
  const encodedKey = ownerPublicKey(brokerEnvironment());
  if (!ownerVerificationKeyPromise || ownerVerificationKeyValue !== encodedKey) {
    ownerVerificationKeyValue = encodedKey;
    ownerVerificationKeyPromise = crypto.subtle.importKey("spki", base64Bytes(encodedKey), { name: "Ed25519" }, false, ["verify"]);
  }
  return ownerVerificationKeyPromise;
}

function invalidOwnerHandoff() {
  return new FacilitiesAuthError(
    401,
    "invalid_owner_handoff",
    "Owner handoff is invalid or expired.",
  );
}

function unavailableOwnerHandoff() {
  return new FacilitiesAuthError(
    503,
    "owner_handoff_unavailable",
    "Owner Facilities access is temporarily unavailable.",
  );
}

async function boundedRequestBody(request: Request): Promise<BrokerBody | null> {
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
      ? (parsed as BrokerBody)
      : null;
  } catch {
    return null;
  }
}

async function responseObject(response: Response) {
  const text = await response.text();
  if (!text || text.length > MAX_UPSTREAM_RESPONSE_BYTES) return null;
  try {
    return asObject(JSON.parse(text));
  } catch {
    return null;
  }
}

function retryAfter(response: Response) {
  const value = response.headers.get("retry-after");
  return value && /^\d{1,6}$/.test(value) ? value : null;
}

function shiftFlowError(
  response: Response,
  body: Record<string, unknown> | null,
) {
  const code = normalizedText(body?.code, 80);
  if (response.status === 429 || code === "login_locked") {
    return new FacilitiesAuthError(
      429,
      "login_locked",
      "Too many sign-in attempts. Try again later.",
      retryAfter(response),
    );
  }
  if (response.status === 409 || code === "punch_id_not_ready") {
    return new FacilitiesAuthError(
      409,
      "punch_id_not_ready",
      "This profile is not ready for Punch ID sign-in. Ask a manager to sync 7shifts.",
    );
  }
  if (response.status === 401 || code === "invalid_login") {
    return new FacilitiesAuthError(
      401,
      "invalid_login",
      "That Punch ID didn’t match. Check it and try again.",
    );
  }
  return new FacilitiesAuthError(
    503,
    "login_unavailable",
    "Punch ID sign-in is temporarily unavailable. Please try again shortly.",
  );
}

function shiftFlowSessionCookie(response: Response) {
  const header = response.headers.get("set-cookie") ?? "";
  const match = new RegExp(
    `(?:^|,\\s*)${SHIFTFLOW_SESSION_COOKIE}=([a-fA-F0-9]{64})(?:;|$)`,
  ).exec(header);
  return match?.[1] ?? null;
}

async function revokeTemporaryShiftFlowSession(token: string | null) {
  if (!token) return;
  try {
    const environment = brokerEnvironment();
    const origin = shiftFlowOrigin(environment);
    await fetchValidatedShiftFlowApi(origin, environment, {
      method: "POST",
      redirect: "error",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
        Cookie: `${SHIFTFLOW_SESSION_COOKIE}=${token}`,
        Origin: origin,
      },
      body: JSON.stringify({ action: "logout" }),
      signal: AbortSignal.timeout(5_000),
    });
  } catch {
    // The short-lived session expires upstream and is never sent to a client.
  }
}

async function authenticateShiftFlowPunch(
  employeeId: string,
  punchId: string,
): Promise<VerifiedEmployee> {
  let response: Response;
  try {
    const environment = brokerEnvironment();
    const origin = shiftFlowOrigin(environment);
    response = await fetchValidatedShiftFlowApi(origin, environment, {
      method: "POST",
      redirect: "error",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
        Origin: origin,
      },
      body: JSON.stringify({
        action: "punch_id_login",
        employeeId,
        punchId,
      }),
      signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
    });
  } catch {
    throw new FacilitiesAuthError(
      503,
      "login_unavailable",
      "Punch ID sign-in is temporarily unavailable. Please try again shortly.",
    );
  }

  const temporarySession = shiftFlowSessionCookie(response);
  let body: Record<string, unknown> | null = null;
  try {
    body = await responseObject(response);
  } finally {
    await revokeTemporaryShiftFlowSession(temporarySession);
  }
  if (!response.ok) throw shiftFlowError(response, body);

  const user = asObject(body?.user);
  const id = normalizedText(user?.id, 80);
  const displayName = normalizedText(user?.displayName, 120);
  const role = user?.role;
  if (
    body?.authenticated !== true ||
    id !== employeeId ||
    !displayName ||
    !isShiftFlowRole(role)
  ) {
    throw new FacilitiesAuthError(
      503,
      "login_unavailable",
      "Punch ID sign-in is temporarily unavailable. Please try again shortly.",
    );
  }

  return { id, displayName, role };
}

function requiredEnvironment(name: string) {
  const value = Deno.env.get(name)?.trim();
  if (!value) {
    throw new FacilitiesAuthError(
      503,
      "login_unavailable",
      "Punch ID sign-in is temporarily unavailable. Please try again shortly.",
    );
  }
  return value;
}

function defaultKeyFromEnvironment(name: string) {
  const raw = Deno.env.get(name)?.trim();
  if (!raw) return "";
  try {
    const values: unknown = JSON.parse(raw);
    const record = asObject(values);
    return typeof record?.default === "string" ? record.default.trim() : "";
  } catch {
    return "";
  }
}

function supabaseClients() {
  validateIsolatedEnvironment(brokerEnvironment(), "broker");
  const url = requiredEnvironment("SUPABASE_URL");
  const serviceKey =
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")?.trim() ||
    Deno.env.get("SUPABASE_SECRET_KEY")?.trim() ||
    defaultKeyFromEnvironment("SUPABASE_SECRET_KEYS");
  const publishableKey =
    Deno.env.get("SUPABASE_ANON_KEY")?.trim() ||
    Deno.env.get("SUPABASE_PUBLISHABLE_KEY")?.trim() ||
    defaultKeyFromEnvironment("SUPABASE_PUBLISHABLE_KEYS");
  if (!serviceKey || !publishableKey) {
    throw new FacilitiesAuthError(
      503,
      "login_unavailable",
      "Punch ID sign-in is temporarily unavailable. Please try again shortly.",
    );
  }
  const options = {
    auth: { persistSession: false, autoRefreshToken: false },
    global: {
      fetch: (input: RequestInfo | URL, init?: RequestInit) => fetch(input, { ...init, redirect: "error" }),
    },
  };
  return {
    admin: createClient(url, serviceKey, options),
    publicAuth: createClient(url, publishableKey, options),
  };
}

function isUserRole(value: unknown): value is UserRole {
  return (
    value === "pending" ||
    value === "staff" ||
    value === "manager" ||
    value === "admin"
  );
}

function asProfile(value: unknown): FacilitiesProfile | null {
  const row = asObject(value);
  const id = normalizedText(row?.id, 80);
  const email = normalizedText(row?.email, 320).toLowerCase();
  const username = normalizedText(row?.username, 120);
  const displayName = row?.display_name === null
    ? null
    : normalizedText(row?.display_name, 120);
  if (
    !/^[0-9a-f-]{36}$/i.test(id) ||
    !email ||
    !username ||
    !isUserRole(row?.role)
  ) {
    return null;
  }
  return { id, email, username, displayName, role: row.role };
}

function asRosterAccount(value: unknown): RosterAccount | null {
  const row = asObject(value);
  const profileId = row?.profile_id === null
    ? null
    : normalizedText(row?.profile_id, 80);
  if (
    typeof row?.active !== "boolean" ||
    (profileId !== null && !/^[0-9a-f-]{36}$/i.test(profileId))
  ) {
    return null;
  }
  return { profileId, active: row.active };
}

function asOwnerAccount(value: unknown): OwnerAccount | null {
  const row = asObject(value);
  const profileId = normalizedText(row?.profile_id, 80);
  if (
    typeof row?.active !== "boolean" ||
    !/^[0-9a-f-]{36}$/i.test(profileId)
  ) {
    return null;
  }
  return { profileId, active: row.active };
}

async function loadOwnerAccount(admin: SupabaseClient) {
  const { data, error } = await admin
    .from("facilities_owner_accounts")
    .select("profile_id,active")
    .eq("owner_source", "staff_tools")
    .eq("owner_id", OWNER_ID)
    .maybeSingle();
  if (error) throw new Error("Owner account lookup failed");
  if (!data) return null;
  const account = asOwnerAccount(data);
  if (!account) throw new Error("Owner account identity is invalid");
  return account;
}

async function loadRosterAccount(
  admin: SupabaseClient,
  companyId: string,
  employeeId: string,
) {
  const { data, error } = await admin
    .from("staff_roster_accounts")
    .select("profile_id,active")
    .eq("roster_source", ROSTER_SOURCE)
    .eq("company_id", companyId)
    .eq("employee_id", employeeId)
    .maybeSingle();
  if (error) throw new Error("Roster lookup failed");
  if (!data) return null;
  const roster = asRosterAccount(data);
  if (!roster) throw new Error("Roster identity is invalid");
  return roster;
}

async function loadProfileById(admin: SupabaseClient, profileId: string) {
  const { data, error } = await admin
    .from("profiles")
    .select("id,email,username,display_name,role")
    .eq("id", profileId)
    .maybeSingle();
  if (error) throw new Error("Profile lookup failed");
  if (!data) return null;
  const profile = asProfile(data);
  if (!profile) throw new Error("Facilities profile is invalid");
  return profile;
}

async function loadProfileByIdentity(
  admin: SupabaseClient,
  identity: FacilitiesIdentity,
) {
  const [emailResult, usernameResult] = await Promise.all([
    admin
      .from("profiles")
      .select("id,email,username,display_name,role")
      .eq("email", identity.email)
      .maybeSingle(),
    admin
      .from("profiles")
      .select("id,email,username,display_name,role")
      .eq("username", identity.username)
      .maybeSingle(),
  ]);
  if (emailResult.error || usernameResult.error) {
    throw new Error("Profile lookup failed");
  }
  const byEmail = emailResult.data ? asProfile(emailResult.data) : null;
  const byUsername = usernameResult.data ? asProfile(usernameResult.data) : null;
  if (
    (emailResult.data && !byEmail) ||
    (usernameResult.data && !byUsername) ||
    (byEmail && byUsername && byEmail.id !== byUsername.id)
  ) {
    throw new Error("Facilities account identity conflict");
  }
  const profile = byEmail ?? byUsername;
  if (
    profile &&
    (profile.email !== identity.email || profile.username !== identity.username)
  ) {
    throw new Error("Facilities account identity conflict");
  }
  return profile;
}

async function facilitiesIdentity(employeeId: string): Promise<FacilitiesIdentity> {
  const bytes = new TextEncoder().encode(
    `facilities-shiftflow-account-v1:${employeeId}`,
  );
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", bytes));
  const hex = Array.from(digest, (byte) => byte.toString(16).padStart(2, "0")).join("");
  return {
    email: `shiftflow-${hex.slice(0, 32)}@auth.onpar.invalid`,
    username: `shiftflow_${hex.slice(0, 24)}`,
  };
}

function randomThrowawayPassword() {
  const bytes = crypto.getRandomValues(
    new Uint8Array(THROWAWAY_PASSWORD_RANDOM_BYTES),
  );
  const hex = Array.from(bytes, (byte) =>
    byte.toString(16).padStart(2, "0")
  ).join("");
  const password = `${hex}${THROWAWAY_PASSWORD_SUFFIX}`;
  if (password.length > SUPABASE_PASSWORD_MAX_LENGTH) {
    throw new Error("Generated throwaway password exceeds the Auth limit");
  }
  return password;
}

async function retireLegacyPunchPassword(
  admin: SupabaseClient,
  employeeId: string,
  profile: FacilitiesProfile,
) {
  const identity = await facilitiesIdentity(employeeId);
  if (
    profile.email !== identity.email ||
    profile.username !== identity.username
  ) {
    return;
  }

  // Early versions used a deterministic password for synthetic Punch users.
  // Replace it with an unrecorded random value; all current sessions are
  // minted with a one-time magic-link token instead of a password.
  const { error } = await admin.auth.admin.updateUserById(profile.id, {
    password: randomThrowawayPassword(),
  });
  if (error) throw new Error("Legacy Punch credential retirement failed");
}

async function provisionCandidate(
  admin: SupabaseClient,
  employee: VerifiedEmployee,
): Promise<FacilitiesProfile> {
  const identity = await facilitiesIdentity(employee.id);
  const existing = await loadProfileByIdentity(admin, identity);
  if (existing) return existing;

  const userMetadata = {
    auth_source: "shiftflow_punch",
    display_name: employee.displayName,
    shiftflow_employee_id: employee.id,
    username: identity.username,
  };
  const created = await admin.auth.admin.createUser({
    email: identity.email,
    email_confirm: true,
    user_metadata: userMetadata,
  });
  let authUserId = created.data.user?.id ?? "";
  if (!authUserId) {
    // Repair an Auth-only account left by an interrupted earlier attempt
    // without scanning or guessing across the Auth user list.
    const { data, error } = await admin.auth.admin.generateLink({
      type: "magiclink",
      email: identity.email,
      options: { data: userMetadata },
    });
    if (error || !data.user) {
      throw new Error("Facilities Auth user creation failed");
    }
    authUserId = data.user.id;
  }

  let profile = await loadProfileById(admin, authUserId);
  if (!profile) {
    const { data, error } = await admin
      .from("profiles")
      .insert({
        id: authUserId,
        email: identity.email,
        username: identity.username,
        display_name: employee.displayName,
        role: facilitiesRoleForNewShiftFlowProfile(employee.role),
      })
      .select("id,email,username,display_name,role")
      .single();
    if (!error && data) profile = asProfile(data);
    if (!profile) {
      profile = await loadProfileByIdentity(admin, identity);
    }
  }
  if (
    !profile ||
    profile.id !== authUserId ||
    profile.email !== identity.email ||
    profile.username !== identity.username
  ) {
    throw new Error("Facilities profile creation failed");
  }

  return profile;
}

async function applyVerifiedShiftFlowRole(
  admin: SupabaseClient,
  profile: FacilitiesProfile,
  shiftFlowRole: ShiftFlowRole,
): Promise<FacilitiesProfile> {
  if (
    shiftFlowRole === "employee" ||
    profile.role === "manager" ||
    profile.role === "admin"
  ) {
    return profile;
  }

  // Only the two non-privileged Facilities roles may be promoted. Matching the
  // role we just loaded prevents this write from overwriting a concurrent
  // manual manager/admin assignment.
  const { data, error } = await admin
    .from("profiles")
    .update({ role: "manager" })
    .eq("id", profile.id)
    .eq("role", profile.role)
    .select("id,email,username,display_name,role")
    .maybeSingle();
  if (error) throw new Error("Facilities role promotion failed");

  if (data) {
    const promoted = asProfile(data);
    if (
      !promoted ||
      promoted.id !== profile.id ||
      promoted.role !== "manager"
    ) {
      throw new Error("Facilities role promotion returned an invalid profile");
    }
    return promoted;
  }

  // A manager may have changed the Facilities role between the read and this
  // guarded update. Preserve an already-privileged manual assignment.
  const current = await loadProfileById(admin, profile.id);
  if (current?.role === "manager" || current?.role === "admin") return current;
  throw new Error("Facilities role promotion did not apply");
}

async function provisionOwner(admin: SupabaseClient): Promise<FacilitiesProfile> {
  let ownerAccount = await loadOwnerAccount(admin);
  if (ownerAccount && !ownerAccount.active) {
    throw new FacilitiesAuthError(
      403,
      "owner_account_inactive",
      "Owner Facilities access is inactive.",
    );
  }

  let profile = ownerAccount
    ? await loadProfileById(admin, ownerAccount.profileId)
    : await loadProfileByIdentity(admin, OWNER_IDENTITY);

  if (!ownerAccount && !profile) {
    const userMetadata = {
      auth_source: "staff_tools_owner",
      display_name: OWNER_DISPLAY_NAME,
      owner_id: OWNER_ID,
      username: OWNER_IDENTITY.username,
    };
    const created = await admin.auth.admin.createUser({
      email: OWNER_IDENTITY.email,
      email_confirm: true,
      user_metadata: userMetadata,
    });
    let authUserId = created.data.user?.id ?? "";
    if (!authUserId) {
      const { data, error } = await admin.auth.admin.generateLink({
        type: "magiclink",
        email: OWNER_IDENTITY.email,
        options: { data: userMetadata },
      });
      if (error || !data.user) {
        throw new Error("Owner Auth user creation failed");
      }
      authUserId = data.user.id;
    }

    profile = await loadProfileById(admin, authUserId);
    if (!profile) {
      const { data, error } = await admin
        .from("profiles")
        .insert({
          id: authUserId,
          email: OWNER_IDENTITY.email,
          username: OWNER_IDENTITY.username,
          display_name: OWNER_DISPLAY_NAME,
          role: "admin",
        })
        .select("id,email,username,display_name,role")
        .single();
      if (!error && data) profile = asProfile(data);
      if (!profile) profile = await loadProfileByIdentity(admin, OWNER_IDENTITY);
    }
  }

  if (
    !profile ||
    profile.email !== OWNER_IDENTITY.email ||
    profile.username !== OWNER_IDENTITY.username
  ) {
    throw new Error("Owner Facilities profile identity conflict");
  }
  if (profile.role !== "admin") {
    throw new FacilitiesAuthError(
      403,
      "owner_role_invalid",
      "Owner Facilities access is not configured as Admin.",
    );
  }

  const { data: rosterLink, error: rosterError } = await admin
    .from("staff_roster_accounts")
    .select("id")
    .eq("profile_id", profile.id)
    .maybeSingle();
  if (rosterError || rosterLink) {
    throw new Error("Owner Facilities profile cannot be a roster account");
  }

  if (!ownerAccount) {
    const { error } = await admin.from("facilities_owner_accounts").insert({
      profile_id: profile.id,
      owner_source: "staff_tools",
      owner_id: OWNER_ID,
      active: true,
    });
    if (error && error.code !== "23505") {
      throw new Error("Owner Facilities account creation failed");
    }
    ownerAccount = await loadOwnerAccount(admin);
  }
  if (
    !ownerAccount?.active ||
    ownerAccount.profileId !== profile.id
  ) {
    throw new Error("Owner Facilities account identity conflict");
  }

  return profile;
}

async function claimRosterAccount(
  admin: SupabaseClient,
  initial: RosterAccount | null,
  companyId: string,
  employee: VerifiedEmployee,
  profileId: string,
) {
  const now = new Date().toISOString();
  if (initial) {
    if (!initial.active) {
      throw new FacilitiesAuthError(
        403,
        "account_inactive",
        "This Facilities account is inactive. Ask a manager to sync 7shifts.",
      );
    }
    if (initial.profileId === null) {
      const { error } = await admin
        .from("staff_roster_accounts")
        .update({
          profile_id: profileId,
          display_name: employee.displayName,
          last_seen_at: now,
        })
        .eq("roster_source", ROSTER_SOURCE)
        .eq("company_id", companyId)
        .eq("employee_id", employee.id)
        .eq("active", true)
        .is("profile_id", null);
      if (error) throw new Error("Roster link failed");
    }
  } else {
    const { error } = await admin.from("staff_roster_accounts").insert({
      profile_id: profileId,
      roster_source: ROSTER_SOURCE,
      company_id: companyId,
      employee_id: employee.id,
      active: true,
      display_name: employee.displayName,
      department_names: [],
      last_seen_at: now,
      last_synced_at: now,
    });
    if (error && error.code !== "23505") {
      throw new Error("Roster link failed");
    }
  }

  const resolved = await loadRosterAccount(admin, companyId, employee.id);
  if (!resolved?.active) {
    throw new FacilitiesAuthError(
      403,
      "account_inactive",
      "This Facilities account is inactive. Ask a manager to sync 7shifts.",
    );
  }
  if (!resolved.profileId) throw new Error("Roster link failed");

  const { error: touchError } = await admin
    .from("staff_roster_accounts")
    .update({ display_name: employee.displayName, last_seen_at: now })
    .eq("roster_source", ROSTER_SOURCE)
    .eq("company_id", companyId)
    .eq("employee_id", employee.id)
    .eq("active", true);
  if (touchError) throw new Error("Roster update failed");
  return resolved.profileId;
}

async function mintSession(
  admin: SupabaseClient,
  publicAuth: SupabaseClient,
  profile: FacilitiesProfile,
) {
  const { data: linkData, error: linkError } =
    await admin.auth.admin.generateLink({
      type: "magiclink",
      email: profile.email,
    });
  if (
    linkError ||
    !linkData.user ||
    linkData.user.id !== profile.id ||
    !linkData.properties.hashed_token
  ) {
    throw new Error("Facilities session link failed");
  }

  const { data, error } = await publicAuth.auth.verifyOtp({
    token_hash: linkData.properties.hashed_token,
    type: "email",
  });
  if (
    error ||
    !data.session ||
    !data.user ||
    data.user.id !== profile.id ||
    data.session.user.id !== profile.id
  ) {
    throw new Error("Facilities session exchange failed");
  }
  return data.session;
}

async function verifyOwnerAssertion(assertion: unknown) {
  if (
    typeof assertion !== "string" ||
    assertion.length < 100 ||
    assertion.length > 4_000 ||
    !/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(assertion)
  ) {
    throw invalidOwnerHandoff();
  }

  try {
    const { payload, protectedHeader } = await jwtVerify(
      assertion,
      await ownerVerificationKey(),
      {
        algorithms: ["EdDSA"],
        audience: OWNER_ASSERTION_AUDIENCE,
        issuer: OWNER_ASSERTION_ISSUER,
        clockTolerance: 5,
        typ: "JWT",
      },
    );
    const now = Math.floor(Date.now() / 1_000);
    if (
      protectedHeader.alg !== "EdDSA" ||
      protectedHeader.kid !== OWNER_ASSERTION_KEY_ID ||
      payload.sub !== OWNER_ID ||
      payload.kind !== OWNER_ASSERTION_KIND ||
      payload.owner_name !== OWNER_DISPLAY_NAME ||
      typeof payload.jti !== "string" ||
      !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
        payload.jti,
      ) ||
      typeof payload.iat !== "number" ||
      typeof payload.exp !== "number" ||
      payload.exp <= payload.iat ||
      payload.exp - payload.iat > 60 ||
      payload.iat > now + 5 ||
      payload.exp <= now
    ) {
      throw invalidOwnerHandoff();
    }
    return { assertionJti: payload.jti, ownerId: payload.sub };
  } catch (error) {
    if (error instanceof FacilitiesAuthError) throw error;
    throw invalidOwnerHandoff();
  }
}

async function createOwnerHandoff(body: BrokerBody) {
  const assertion = await verifyOwnerAssertion(body.assertion);
  const ticketBytes = crypto.getRandomValues(new Uint8Array(32));
  const ticket = base64Url(ticketBytes);
  const ticketHash = await sha256Hex(ticket);
  const expiresAt = new Date(Date.now() + OWNER_TICKET_SECONDS * 1_000);
  const { admin } = supabaseClients();

  const assertionJtiHash = await sha256Hex(assertion.assertionJti);
  const { error } = await admin.from("facilities_owner_handoffs").insert({
    assertion_jti_hash: assertionJtiHash,
    owner_id: assertion.ownerId,
    ticket_hash: ticketHash,
    expires_at: expiresAt.toISOString(),
  });
  if (error?.code === "23505") throw invalidOwnerHandoff();
  if (error) throw unavailableOwnerHandoff();

  // Cleanup is opportunistic and never affects a valid launch.
  await admin
    .from("facilities_owner_handoffs")
    .delete()
    .lt("expires_at", new Date(Date.now() - 86_400_000).toISOString());

  return jsonResponse(200, {
    ok: true,
    ticket,
    expiresIn: OWNER_TICKET_SECONDS,
  });
}

async function exchangeOwnerHandoff(body: BrokerBody) {
  const ticket = typeof body.ticket === "string" ? body.ticket.trim() : "";
  if (!/^[A-Za-z0-9_-]{43}$/.test(ticket)) throw invalidOwnerHandoff();

  const ticketHash = await sha256Hex(ticket);
  const now = new Date().toISOString();
  const { admin, publicAuth } = supabaseClients();
  const { data, error } = await admin
    .from("facilities_owner_handoffs")
    .update({ used_at: now })
    .eq("ticket_hash", ticketHash)
    .is("used_at", null)
    .gt("expires_at", now)
    .select("owner_id")
    .maybeSingle();
  if (error) throw unavailableOwnerHandoff();
  if (!data || normalizedText(data.owner_id, 80) !== OWNER_ID) {
    throw invalidOwnerHandoff();
  }

  // Consume before provisioning/session work. A transient failure requires a
  // fresh owner launch instead of allowing the bearer ticket to be retried.
  const profile = await provisionOwner(admin);
  const session = await mintSession(admin, publicAuth, profile);
  return jsonResponse(200, {
    ok: true,
    role: "admin",
    accessToken: session.access_token,
    refreshToken: session.refresh_token,
  });
}

async function login(body: BrokerBody) {
  const employeeId =
    typeof body.employeeId === "string" ? body.employeeId.trim() : "";
  const punchId = typeof body.punchId === "string" ? body.punchId.trim() : "";
  if (!/^[A-Za-z0-9_-]{1,80}$/.test(employeeId) || !/^\d{1,12}$/.test(punchId)) {
    throw new FacilitiesAuthError(
      401,
      "invalid_login",
      "That Punch ID didn’t match. Check it and try again.",
    );
  }

  // The Punch ID is sent only to ShiftFlow for this verification call. It is
  // never placed in metadata, database rows, logs, or the response.
  const employee = await authenticateShiftFlowPunch(employeeId, punchId);
  const { admin, publicAuth } = supabaseClients();

  const initialRoster = await loadRosterAccount(
    admin,
    ROSTER_COMPANY_ID,
    employee.id,
  );
  if (initialRoster && !initialRoster.active) {
    throw new FacilitiesAuthError(
      403,
      "account_inactive",
      "This Facilities account is inactive. Ask a manager to sync 7shifts.",
    );
  }

  let profile: FacilitiesProfile | null = null;
  if (initialRoster?.profileId) {
    profile = await loadProfileById(admin, initialRoster.profileId);
    if (!profile) throw new Error("Mapped Facilities profile is missing");
  } else {
    const candidate = await provisionCandidate(admin, employee);
    const linkedProfileId = await claimRosterAccount(
      admin,
      initialRoster,
      ROSTER_COMPANY_ID,
      employee,
      candidate.id,
    );
    profile = await loadProfileById(admin, linkedProfileId);
    if (!profile) throw new Error("Mapped Facilities profile is missing");
  }

  if (initialRoster?.profileId) {
    await claimRosterAccount(
      admin,
      initialRoster,
      ROSTER_COMPANY_ID,
      employee,
      profile.id,
    );
  }
  profile = await applyVerifiedShiftFlowRole(admin, profile, employee.role);
  await retireLegacyPunchPassword(admin, employee.id, profile);
  const session = await mintSession(
    admin,
    publicAuth,
    profile,
  );
  return jsonResponse(200, {
    ok: true,
    role: profile.role,
    accessToken: session.access_token,
    refreshToken: session.refresh_token,
  });
}

Deno.serve(async (request) => {
  if (request.method !== "POST") {
    return jsonResponse(405, {
      ok: false,
      code: "method_not_allowed",
      error: "Method not allowed.",
    });
  }

  let requestedAction = "";
  try {
    validateIsolatedEnvironment(brokerEnvironment(), "broker");
    const body = await boundedRequestBody(request);
    requestedAction = typeof body?.action === "string" ? body.action : "";
    if (!body) {
      return jsonResponse(400, {
        ok: false,
        code: "invalid_request",
        error: "Invalid request.",
      });
    }
    if (requestedAction === "employee_removal") {
      if (Deno.env.get("FACILITIES_ISOLATED_STAGING") !== "true" ||
          Deno.env.get("EMPLOYEE_REMOVAL_ENABLED") !== "true") {
        return jsonResponse(404, { ok: false, error: "Not found" });
      }
      let removal;
      try {
        removal = await verifyEmployeeRemoval(body.assertion, Deno.env.get("EMPLOYEE_REMOVAL_PUBLIC_KEY"), "ope-facilities-employee-removal");
      } catch { return jsonResponse(401, { ok: false, error: "Unauthorized" }); }
      const { admin } = supabaseClients();
      const { data, error } = await admin.from("staff_roster_accounts")
        .update({ active: false })
        .eq("roster_source", ROSTER_SOURCE).eq("company_id", ROSTER_COMPANY_ID)
        .eq("employee_id", removal.employeeId).eq("active", true)
        .select("profile_id");
      if (error) return jsonResponse(503, { ok: false, error: "Employee removal unavailable" });
      return jsonResponse(200, { ok: true, changed: data?.length ?? 0 });
    }
    if (requestedAction === "login") return await login(body);
    if (requestedAction === "owner_handoff_create") {
      return await createOwnerHandoff(body);
    }
    if (requestedAction === "owner_handoff_exchange") {
      return await exchangeOwnerHandoff(body);
    }
    return jsonResponse(400, {
      ok: false,
      code: "invalid_request",
      error: "Invalid request.",
    });
  } catch (error) {
    if (error instanceof FacilitiesAuthError) {
      return jsonResponse(
        error.status,
        { ok: false, code: error.code, error: error.message },
        error.retryAfter,
      );
    }
    if (requestedAction === "employee_removal") {
      return jsonResponse(503, { ok: false, error: "Employee removal unavailable" });
    }
    if (requestedAction.startsWith("owner_handoff_")) {
      return jsonResponse(503, {
        ok: false,
        code: "owner_handoff_unavailable",
        error: "Owner Facilities access is temporarily unavailable.",
      });
    }
    return jsonResponse(503, {
      ok: false,
      code: "login_unavailable",
      error: "Punch ID sign-in is temporarily unavailable. Please try again shortly.",
    });
  }
});
