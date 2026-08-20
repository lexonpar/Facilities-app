import { NextResponse } from "next/server";
import type { SupabaseClient, User } from "@supabase/supabase-js";
import {
  authenticateShiftFlowPunch,
  facilitiesPunchIdentity,
  facilitiesRoleForShiftFlow,
  ShiftFlowPunchError,
} from "@/lib/auth/shiftflow-punch";
import { createClient, createServiceClient } from "@/lib/supabase/server";
import type { UserRole } from "@/lib/types/profile";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_BODY_BYTES = 1_024;
const NO_STORE_HEADERS = { "Cache-Control": "private, no-store" };

type PunchLoginBody = {
  employeeId?: unknown;
  punchId?: unknown;
};

type PunchProfile = {
  id: string;
  email: string;
  username: string;
};

function responseHeaders(retryAfterSeconds: number | null = null) {
  const headers = new Headers(NO_STORE_HEADERS);
  if (retryAfterSeconds) {
    headers.set("Retry-After", String(retryAfterSeconds));
  }
  return headers;
}

function sameOrigin(request: Request) {
  const origin = request.headers.get("origin");
  return origin !== null && origin === new URL(request.url).origin;
}

async function boundedJson(request: Request): Promise<PunchLoginBody | null> {
  const contentLength = request.headers.get("content-length");
  if (contentLength && (!/^\d+$/.test(contentLength) || Number(contentLength) > MAX_BODY_BYTES)) {
    return null;
  }
  const text = await request.text();
  if (!text || text.length > MAX_BODY_BYTES) return null;
  try {
    const parsed: unknown = JSON.parse(text);
    return parsed !== null && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as PunchLoginBody)
      : null;
  } catch {
    return null;
  }
}

async function findAuthUserByEmail(
  service: SupabaseClient,
  email: string,
): Promise<User | null> {
  for (let page = 1; page <= 5; page += 1) {
    const { data, error } = await service.auth.admin.listUsers({
      page,
      perPage: 200,
    });
    if (error) throw new Error("Facilities account lookup failed");
    const match = data.users.find(
      (user) => user.email?.trim().toLowerCase() === email,
    );
    if (match) return match;
    if (data.users.length < 200) break;
  }
  return null;
}

async function ensurePunchAccount(
  employeeId: string,
  displayName: string,
  role: UserRole,
) {
  const identity = facilitiesPunchIdentity(employeeId);
  const service = createServiceClient();
  const { data: profile, error: profileError } = await service
    .from("profiles")
    .select("id,email,username")
    .eq("username", identity.username)
    .maybeSingle<PunchProfile>();
  if (profileError) throw new Error("Facilities account lookup failed");

  let userId = profile?.id ?? null;
  if (profile && profile.email.trim().toLowerCase() !== identity.email) {
    throw new Error("Facilities account identity conflict");
  }

  if (userId) {
    const { error } = await service.auth.admin.updateUserById(userId, {
      password: identity.password,
      user_metadata: {
        auth_source: "shiftflow_punch",
        display_name: displayName,
        shiftflow_employee_id: employeeId,
        username: identity.username,
      },
    });
    if (error) throw new Error("Facilities account update failed");
  } else {
    const created = await service.auth.admin.createUser({
      email: identity.email,
      password: identity.password,
      email_confirm: true,
      user_metadata: {
        auth_source: "shiftflow_punch",
        display_name: displayName,
        shiftflow_employee_id: employeeId,
        username: identity.username,
      },
    });
    if (!created.error && created.data.user) {
      userId = created.data.user.id;
    } else {
      const existing = await findAuthUserByEmail(service, identity.email);
      if (!existing) throw new Error("Facilities account creation failed");
      userId = existing.id;
      const { error } = await service.auth.admin.updateUserById(userId, {
        password: identity.password,
        user_metadata: {
          auth_source: "shiftflow_punch",
          display_name: displayName,
          shiftflow_employee_id: employeeId,
          username: identity.username,
        },
      });
      if (error) throw new Error("Facilities account update failed");
    }
  }

  if (!userId) throw new Error("Facilities account creation failed");
  const { error: upsertError } = await service.from("profiles").upsert(
    {
      id: userId,
      email: identity.email,
      username: identity.username,
      display_name: displayName,
      role,
    },
    { onConflict: "id" },
  );
  if (upsertError) throw new Error("Facilities profile update failed");

  return identity;
}

export async function POST(request: Request) {
  if (!sameOrigin(request)) {
    return NextResponse.json(
      { ok: false, code: "invalid_origin", error: "Request origin is not allowed." },
      { status: 403, headers: NO_STORE_HEADERS },
    );
  }

  let body: PunchLoginBody | null;
  try {
    body = await boundedJson(request);
  } catch {
    body = null;
  }
  const employeeId = typeof body?.employeeId === "string" ? body.employeeId.trim() : "";
  const punchId = typeof body?.punchId === "string" ? body.punchId.trim() : "";
  if (!/^[A-Za-z0-9_-]{1,80}$/.test(employeeId) || !/^\d{1,12}$/.test(punchId)) {
    return NextResponse.json(
      {
        ok: false,
        code: "invalid_login",
        error: "That Punch ID didn’t match. Check it and try again.",
      },
      { status: 401, headers: NO_STORE_HEADERS },
    );
  }

  try {
    const shiftFlowUser = await authenticateShiftFlowPunch(employeeId, punchId);
    const role = facilitiesRoleForShiftFlow(shiftFlowUser.role);
    const identity = await ensurePunchAccount(
      shiftFlowUser.id,
      shiftFlowUser.displayName,
      role,
    );
    const supabase = await createClient();
    const { error } = await supabase.auth.signInWithPassword({
      email: identity.email,
      password: identity.password,
    });
    if (error) throw new Error("Facilities session creation failed");

    return NextResponse.json(
      {
        ok: true,
        role,
        redirect: role === "manager" || role === "admin" ? "/lead" : "/submit",
      },
      { headers: NO_STORE_HEADERS },
    );
  } catch (error) {
    if (error instanceof ShiftFlowPunchError) {
      return NextResponse.json(
        { ok: false, code: error.code, error: error.message },
        {
          status: error.status,
          headers: responseHeaders(error.retryAfterSeconds),
        },
      );
    }
    return NextResponse.json(
      {
        ok: false,
        code: "login_unavailable",
        error: "Punch ID sign-in is temporarily unavailable. Please try again shortly.",
      },
      { status: 503, headers: NO_STORE_HEADERS },
    );
  }
}
