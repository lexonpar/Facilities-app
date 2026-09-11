import type { SupabaseClient } from "@supabase/supabase-js";
import type { UserRole } from "@/lib/types/profile";

export type FacilitiesAccess = {
  active: boolean;
  role: UserRole;
};

function isUserRole(value: unknown): value is UserRole {
  return (
    value === "pending" ||
    value === "staff" ||
    value === "manager" ||
    value === "admin"
  );
}

/**
 * Loads the database-backed role and roster status used for optimistic routing.
 * Secure mutations repeat the same authorization in the server auth helper/RLS.
 */
export async function getFacilitiesAccess(
  supabase: SupabaseClient,
  userId: string,
): Promise<FacilitiesAccess | null> {
  try {
    const [profileResult, rosterResult, ownerResult] = await Promise.all([
      supabase.from("profiles").select("role").eq("id", userId).maybeSingle(),
      supabase
        .from("staff_roster_accounts")
        .select("active")
        .eq("profile_id", userId)
        .eq("roster_source", "shiftflow")
        .eq("company_id", "on-par")
        .maybeSingle(),
      supabase
        .from("facilities_owner_accounts")
        .select("active")
        .eq("profile_id", userId)
        .eq("owner_source", "staff_tools")
        .eq("owner_id", "emp-alexis-younker")
        .maybeSingle(),
    ]);

    const role = profileResult.data?.role;
    if (
      profileResult.error ||
      rosterResult.error ||
      ownerResult.error ||
      !isUserRole(role)
    ) {
      return null;
    }

    return {
      role,
      active:
        rosterResult.data?.active === true || ownerResult.data?.active === true,
    };
  } catch {
    return null;
  }
}
