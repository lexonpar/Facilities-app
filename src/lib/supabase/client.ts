import { createBrowserClient } from "@supabase/ssr";
import { getSupabaseAnonKey, getSupabaseUrl, isSupabaseConfigured } from "./env";
import { fetchSupabase } from "./request";

export { isSupabaseConfigured };

export function createClient() {
  const url = getSupabaseUrl();
  const key = getSupabaseAnonKey();

  if (!url || !key) {
    throw new Error(
      "Missing Supabase URL or publishable/anon key. Set NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY (or ANON_KEY) in .env",
    );
  }

  return createBrowserClient(url, key, { global: { fetch: fetchSupabase } });
}
