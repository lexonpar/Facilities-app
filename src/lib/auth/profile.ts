import type { SupabaseClient } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";
import type { Profile } from "@/lib/types/profile";

/** Load the signed-in user's own profile through its RLS-protected session. */
export async function loadProfileByUserId(
  userId: string,
  client?: SupabaseClient,
): Promise<Profile | null> {
  try {
    const supabase = client ?? (await createClient());
    const { data, error } = await supabase
      .from("profiles")
      .select("*")
      .eq("id", userId)
      .single();

    if (error || !data) return null;
    return data as Profile;
  } catch {
    return null;
  }
}
