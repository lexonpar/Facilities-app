import { NextResponse } from "next/server";
import { loadProfileByUserId } from "@/lib/auth/profile";
import {
  facilitiesPunchIdentity,
  loadActiveShiftFlowEmployees,
} from "@/lib/auth/shiftflow-punch";
import { createClient, createServiceClient } from "@/lib/supabase/server";
import type { Profile, UserRole } from "@/lib/types/profile";
import { canAccessManagerDashboard, canManageTeam } from "@/lib/types/profile";

export type AuthContext = {
  userId: string;
  email: string;
  profile: Profile;
};

export async function getAuthContext(): Promise<AuthContext | null> {
  const supabase = await createClient();
  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser();

  if (userError || !user?.email) return null;

  const profile = await loadProfileByUserId(user.id);
  if (!profile) return null;

  if (profile.email.toLowerCase().endsWith("@auth.onpar.invalid")) {
    const employeeId =
      typeof user.user_metadata.shiftflow_employee_id === "string"
        ? user.user_metadata.shiftflow_employee_id.trim()
        : "";
    let active: boolean | null = null;
    if (!/^[A-Za-z0-9_-]{1,80}$/.test(employeeId)) {
      active = false;
    } else {
      try {
        const expected = facilitiesPunchIdentity(employeeId);
        const identityMatches =
          expected.email === user.email.trim().toLowerCase() &&
          expected.email === profile.email.trim().toLowerCase() &&
          expected.username === profile.username;
        if (identityMatches) {
          const employees = await loadActiveShiftFlowEmployees();
          active = employees.some((employee) => employee.id === employeeId);
        } else {
          active = false;
        }
      } catch {
        // A temporary upstream/configuration outage blocks this request without
        // permanently changing the employee's Facilities role.
        return null;
      }
    }

    if (active === false) {
      try {
        const service = createServiceClient();
        await service
          .from("profiles")
          .update({ role: "pending" })
          .eq("id", user.id);
        await supabase.auth.signOut();
      } catch {
        // Returning no context still prevents protected API access.
      }
      return null;
    }
  }

  return {
    userId: user.id,
    email: user.email,
    profile: profile as Profile,
  };
}

export async function requireManagerAuth(): Promise<
  AuthContext | NextResponse
> {
  const ctx = await getAuthContext();
  if (!ctx) {
    return NextResponse.json({ error: "Sign in required" }, { status: 401 });
  }
  if (!canAccessManagerDashboard(ctx.profile.role)) {
    return NextResponse.json(
      { error: "Manager access not granted for this account" },
      { status: 403 },
    );
  }
  return ctx;
}

export async function requireAdminAuth(): Promise<AuthContext | NextResponse> {
  const ctx = await getAuthContext();
  if (!ctx) {
    return NextResponse.json({ error: "Sign in required" }, { status: 401 });
  }
  if (!canManageTeam(ctx.profile.role)) {
    return NextResponse.json({ error: "Admin access required" }, { status: 403 });
  }
  return ctx;
}

export function isAuthContext(
  value: AuthContext | NextResponse,
): value is AuthContext {
  return "profile" in value && "userId" in value;
}

export const ASSIGNABLE_ROLES: UserRole[] = [
  "pending",
  "staff",
  "manager",
  "admin",
];
