import { validateIsolatedEnvironment } from "../../../supabase/functions/_shared/environment";

/** Raw public configuration is only for local cookie cleanup when auth is unavailable. */
export function getConfiguredSupabaseUrl(): string {
  return process.env.NEXT_PUBLIC_SUPABASE_URL?.trim() ?? "";
}

/** Resolves Supabase URL and anon/publishable key from env (supports new Supabase key names). */
export function getSupabaseUrl(): string {
  if (typeof window === "undefined") validateIsolatedEnvironment(process.env, "web");
  return getConfiguredSupabaseUrl();
}

export function getSupabaseAnonKey(): string {
  return (
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY?.trim() ||
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY?.trim() ||
    process.env.SUPABASE_PUBLISHABLE_KEY?.trim() ||
    ""
  );
}

export function isSupabaseConfigured(): boolean {
  return Boolean(getSupabaseUrl() && getSupabaseAnonKey());
}
