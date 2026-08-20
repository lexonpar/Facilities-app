import "server-only";

import { createHash, createHmac } from "node:crypto";
import type { UserRole } from "@/lib/types/profile";

const SHIFTFLOW_ORIGIN = "https://shiftflow-onpar.alexis953849.chatgpt.site";
const SHIFTFLOW_API = `${SHIFTFLOW_ORIGIN}/api/shiftflow`;
const SHIFTFLOW_SESSION_COOKIE = "shiftflow_session";
const UPSTREAM_TIMEOUT_MS = 12_000;

export type ActiveShiftFlowEmployee = {
  id: string;
  displayName: string;
  departmentNames: string[];
};

type ShiftFlowRole = "employee" | "manager" | "admin";

type ShiftFlowAuthenticatedUser = {
  id: string;
  displayName: string;
  role: ShiftFlowRole;
};

export type FacilitiesPunchIdentity = {
  email: string;
  username: string;
  password: string;
};

export class ShiftFlowPunchError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly retryAfterSeconds: number | null = null,
  ) {
    super(message);
    this.name = "ShiftFlowPunchError";
  }
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

async function responseObject(response: Response) {
  const text = await response.text();
  if (!text || text.length > 4_000_000) return null;
  try {
    return asObject(JSON.parse(text));
  } catch {
    return null;
  }
}

function retryAfterSeconds(response: Response) {
  const value = response.headers.get("retry-after");
  if (!value || !/^\d+$/.test(value)) return null;
  const seconds = Number(value);
  return Number.isSafeInteger(seconds) && seconds > 0 ? seconds : null;
}

function upstreamError(response: Response, body: Record<string, unknown> | null) {
  const code = normalizedText(body?.code, 80);
  const retryAfter = retryAfterSeconds(response);

  if (response.status === 429 || code === "login_locked") {
    return new ShiftFlowPunchError(
      429,
      "login_locked",
      "Too many sign-in attempts. Try again later.",
      retryAfter,
    );
  }
  if (response.status === 409 || code === "punch_id_not_ready") {
    return new ShiftFlowPunchError(
      409,
      "punch_id_not_ready",
      "This profile is not ready for Punch ID sign-in. Ask a manager to sync 7shifts.",
    );
  }
  if (response.status === 401 || code === "invalid_login") {
    return new ShiftFlowPunchError(
      401,
      "invalid_login",
      "That Punch ID didn’t match. Check it and try again.",
    );
  }
  return new ShiftFlowPunchError(
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
    await fetch(SHIFTFLOW_API, {
      method: "POST",
      cache: "no-store",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
        Cookie: `${SHIFTFLOW_SESSION_COOKIE}=${token}`,
        Origin: SHIFTFLOW_ORIGIN,
      },
      body: JSON.stringify({ action: "logout" }),
      signal: AbortSignal.timeout(5_000),
    });
  } catch {
    // The short-lived ShiftFlow session will expire on its own if revocation
    // cannot be completed. It is never forwarded to the browser.
  }
}

export async function loadActiveShiftFlowEmployees(): Promise<
  ActiveShiftFlowEmployee[]
> {
  let response: Response;
  try {
    response = await fetch(SHIFTFLOW_API, {
      cache: "no-store",
      headers: { Accept: "application/json" },
      signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
    });
  } catch {
    throw new ShiftFlowPunchError(
      503,
      "roster_unavailable",
      "The active employee list is temporarily unavailable.",
    );
  }

  const body = await responseObject(response);
  if (!response.ok || body?.ok !== true || !Array.isArray(body.employees)) {
    throw new ShiftFlowPunchError(
      503,
      "roster_unavailable",
      "The active employee list is temporarily unavailable.",
    );
  }

  const employees: ActiveShiftFlowEmployee[] = [];
  const seen = new Set<string>();
  for (const raw of body.employees) {
    const employee = asObject(raw);
    const id = normalizedText(employee?.id, 80);
    const displayName = normalizedText(employee?.displayName, 120);
    if (!/^[A-Za-z0-9_-]{1,80}$/.test(id) || !displayName || seen.has(id)) {
      continue;
    }
    const departmentNames = Array.isArray(employee?.departmentNames)
      ? employee.departmentNames
          .map((name) => normalizedText(name, 80))
          .filter((name, index, names) => Boolean(name) && names.indexOf(name) === index)
          .slice(0, 8)
      : [];
    seen.add(id);
    employees.push({ id, displayName, departmentNames });
  }
  if (employees.length === 0) {
    throw new ShiftFlowPunchError(
      503,
      "roster_unavailable",
      "The active employee list is temporarily unavailable.",
    );
  }
  return employees.sort((left, right) =>
    left.displayName.localeCompare(right.displayName, "en-US"),
  );
}

export async function authenticateShiftFlowPunch(
  employeeId: string,
  punchId: string,
): Promise<ShiftFlowAuthenticatedUser> {
  if (!/^[A-Za-z0-9_-]{1,80}$/.test(employeeId) || !/^\d{1,12}$/.test(punchId)) {
    throw new ShiftFlowPunchError(
      401,
      "invalid_login",
      "That Punch ID didn’t match. Check it and try again.",
    );
  }

  let response: Response;
  try {
    response = await fetch(SHIFTFLOW_API, {
      method: "POST",
      cache: "no-store",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
        Origin: SHIFTFLOW_ORIGIN,
      },
      body: JSON.stringify({
        action: "punch_id_login",
        employeeId,
        punchId,
      }),
      signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
    });
  } catch {
    throw new ShiftFlowPunchError(
      503,
      "login_unavailable",
      "Punch ID sign-in is temporarily unavailable. Please try again shortly.",
    );
  }

  const temporarySession = shiftFlowSessionCookie(response);
  const body = await responseObject(response);
  if (!response.ok) {
    await revokeTemporaryShiftFlowSession(temporarySession);
    throw upstreamError(response, body);
  }

  const user = asObject(body?.user);
  const id = normalizedText(user?.id, 80);
  const displayName = normalizedText(user?.displayName, 120);
  const role = user?.role;
  const authenticated = body?.authenticated === true;
  const validRole = role === "employee" || role === "manager" || role === "admin";
  await revokeTemporaryShiftFlowSession(temporarySession);

  if (!authenticated || id !== employeeId || !displayName || !validRole) {
    throw new ShiftFlowPunchError(
      503,
      "login_unavailable",
      "Punch ID sign-in is temporarily unavailable. Please try again shortly.",
    );
  }

  return { id, displayName, role };
}

export function facilitiesRoleForShiftFlow(role: ShiftFlowRole): UserRole {
  if (role === "admin") return "admin";
  if (role === "manager") return "manager";
  return "staff";
}

export function facilitiesPunchIdentity(
  employeeId: string,
): FacilitiesPunchIdentity {
  if (!/^[A-Za-z0-9_-]{1,80}$/.test(employeeId)) {
    throw new Error("Invalid ShiftFlow employee identity");
  }
  const secret =
    process.env.SUPABASE_SERVICE_ROLE_KEY?.trim() ||
    process.env.SUPABASE_SECRET_KEY?.trim();
  if (!secret) throw new Error("Supabase service role is not configured");

  const stableDigest = createHash("sha256")
    .update(`facilities-shiftflow-account-v1:${employeeId}`)
    .digest("hex");
  const passwordDigest = createHmac("sha256", secret)
    .update(`facilities-shiftflow-password-v1:${employeeId}`)
    .digest("base64url");

  return {
    email: `shiftflow-${stableDigest.slice(0, 32)}@auth.onpar.invalid`,
    username: `shiftflow_${stableDigest.slice(0, 24)}`,
    password: `${passwordDigest}Aa1!`,
  };
}
