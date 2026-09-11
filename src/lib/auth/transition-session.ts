import "server-only";

import { createServerClient, type CookieOptions } from "@supabase/ssr";
import type { NextRequest, NextResponse } from "next/server";
import { getSupabaseAnonKey, getSupabaseUrl } from "@/lib/supabase/env";
import { clearBrowserSession } from "@/lib/auth/browser-session";

/** A route-local cookie collector: discarded refresh writes cannot undo a reset. */
export function createTransitionSession(request: NextRequest) {
  const url = getSupabaseUrl();
  const key = getSupabaseAnonKey();
  if (!url || !key) throw new Error("Facilities auth is not configured");
  const controller = new AbortController();
  const writes = new Map<string, { name: string; value: string; options: CookieOptions }>();
  const supabase = createServerClient(url, key, {
    global: {
      fetch(input, init) {
        return fetch(input, {
          ...init,
          redirect: "error",
          signal: init?.signal
            ? AbortSignal.any([init.signal, controller.signal])
            : controller.signal,
        });
      },
    },
    cookies: {
      getAll() {
        const values = new Map(request.cookies.getAll().map((cookie) => [cookie.name, cookie]));
        writes.forEach((cookie) => values.set(cookie.name, cookie));
        return [...values.values()];
      },
      setAll(cookies) {
        cookies.forEach((cookie) => writes.set(cookie.name, cookie));
      },
    },
  });
  return {
    supabase,
    async bounded<T>(operation: () => Promise<T>): Promise<T> {
      let timer: ReturnType<typeof setTimeout> | undefined;
      try {
        return await Promise.race([
          operation(),
          new Promise<never>((_, reject) => {
            timer = setTimeout(() => {
              controller.abort();
              reject(new Error("Facilities session check timed out"));
            }, 8000);
          }),
        ]);
      } finally {
        clearTimeout(timer);
      }
    },
    preserveCookies(response: NextResponse) {
      writes.forEach(({ name, value, options }) => response.cookies.set(name, value, options));
    },
    clearCookies(response: NextResponse) {
      controller.abort();
      clearBrowserSession((name, value, options) => response.cookies.set(name, value, options), [
        ...request.cookies.getAll(), ...writes.values(),
      ]);
    },
    abort() { controller.abort(); },
  };
}
