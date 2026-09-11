import "server-only";

import { createHash } from "node:crypto";
import { fetchShiftFlowApi } from "@/lib/config/integrations";

const UPSTREAM_TIMEOUT_MS = 12_000;

export type ActiveShiftFlowEmployee = {
  id: string;
  displayName: string;
  departmentNames: string[];
};

export type FacilitiesPunchIdentity = {
  email: string;
  username: string;
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

export async function loadActiveShiftFlowEmployees(): Promise<
  ActiveShiftFlowEmployee[]
> {
  let response: Response;
  try {
    response = await fetchShiftFlowApi({
      cache: "no-store",
      redirect: "error",
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

export function facilitiesPunchIdentity(
  employeeId: string,
): FacilitiesPunchIdentity {
  if (!/^[A-Za-z0-9_-]{1,80}$/.test(employeeId)) {
    throw new Error("Invalid ShiftFlow employee identity");
  }
  const stableDigest = createHash("sha256")
    .update(`facilities-shiftflow-account-v1:${employeeId}`)
    .digest("hex");

  return {
    email: `shiftflow-${stableDigest.slice(0, 32)}@auth.onpar.invalid`,
    username: `shiftflow_${stableDigest.slice(0, 24)}`,
  };
}
