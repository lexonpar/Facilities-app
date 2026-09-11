import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { BROWSER_PROFILE_COOKIE, browserProfileAllows, browserProfileIsBlocked } from "@/lib/auth/browser-session";
import { loadProfileByUserId } from "@/lib/auth/profile";
import { getFacilitiesAccess } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import type { Profile, UserRole } from "@/lib/types/profile";
import {
  canAccessManagerDashboard,
  canManageTeam,
  canSubmitIssues,
} from "@/lib/types/profile";

export type AuthContext = {
  userId: string;
  email: string;
  profile: Profile;
};

export async function getAuthContext(): Promise<AuthContext | null> {
  const binding = (await cookies()).get(BROWSER_PROFILE_COOKIE)?.value;
  if (browserProfileIsBlocked(binding)) return null;
  const supabase = await createClient();
  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser();

  if (userError || !user?.email || !browserProfileAllows(binding, user.id)) return null;

  const profile = await loadProfileByUserId(user.id, supabase);
  if (!profile) return null;

  const access = await getFacilitiesAccess(supabase, user.id);
  if (!access?.active || access.role !== profile.role) return null;

  return {
    userId: user.id,
    email: user.email,
    profile: profile as Profile,
  };
}

export async function requireStaffAuth(): Promise<AuthContext | NextResponse> {
  const ctx = await getAuthContext();
  if (!ctx) {
    return NextResponse.json({ error: "Sign in required" }, { status: 401 });
  }
  if (!canSubmitIssues(ctx.profile.role)) {
    return NextResponse.json(
      { error: "Staff access is not active for this account" },
      { status: 403 },
    );
  }
  return ctx;
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
