import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { getSupabaseAnonKey, getSupabaseUrl } from "@/lib/supabase/env";
import { fetchSupabase } from "@/lib/supabase/request";

/** Refreshes the Supabase session cookie on every request so devices stay signed in. */
export function createMiddlewareSupabase(
  request: NextRequest,
  response: NextResponse,
) {
  const url = getSupabaseUrl();
  const key = getSupabaseAnonKey();
  if (!url || !key) return null;

  let nextResponse = response;

  const supabase = createServerClient(url, key, {
    global: { fetch: fetchSupabase },
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet, headers) {
        cookiesToSet.forEach(({ name, value }) =>
          request.cookies.set(name, value),
        );
        nextResponse = NextResponse.next({ request });
        cookiesToSet.forEach(({ name, value, options }) =>
          nextResponse.cookies.set(name, value, options),
        );
        Object.entries(headers).forEach(([name, value]) =>
          nextResponse.headers.set(name, value),
        );
      },
    },
  });

  return { supabase, getResponse: () => nextResponse };
}
