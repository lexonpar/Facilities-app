/** Server/broker use only. Callers must resolve origin with shiftFlowOrigin first. */
export function fetchValidatedShiftFlowApi(
  origin: string,
  env: Record<string, string | undefined>,
  init: RequestInit = {},
) {
  const headers = new Headers(init.headers);
  // Only this helper may attach the platform credential, never an incoming header.
  headers.delete("OAI-Sites-Authorization");
  const isolated = env.FACILITIES_ISOLATED_STAGING?.trim().toLowerCase() === "true";
  const token = isolated ? env.SHIFTFLOW_STAGING_API_TOKEN?.trim() : "";
  if (token) {
    let validTarget = false;
    try {
      const target = new URL(origin);
      const configured = new URL(env.SHIFTFLOW_ORIGIN?.trim() || "");
      configured.hostname = configured.hostname.toLowerCase().replace(/\.+$/, "");
      const supabaseHosts = [env.SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_URL]
        .filter((value): value is string => Boolean(value?.trim()))
        .map((value) => new URL(value).hostname.toLowerCase().replace(/\.+$/, ""));
      validTarget = target.protocol === "https:" && origin === target.origin &&
        configured.origin === origin && !configured.username && !configured.password &&
        configured.pathname === "/" && !configured.search && !configured.hash &&
        !/(^|\.)supabase\.(co|com|in)$/.test(target.hostname) &&
        !supabaseHosts.includes(target.hostname);
    } catch { /* A missing or invalid explicit origin must never receive the token. */ }
    if (!validTarget) throw new Error("Facilities configuration is invalid: private staging ShiftFlow origin");
    if (token.length > 8_192 || !/^[A-Za-z0-9._~+\/-]+=*$/.test(token)) {
      throw new Error("Facilities configuration is invalid: SHIFTFLOW_STAGING_API_TOKEN");
    }
    headers.set("OAI-Sites-Authorization", `Bearer ${token}`);
  }
  // Fix both the endpoint and redirect policy so credentials cannot follow a redirect.
  return fetch(`${origin}/api/shiftflow`, { ...init, headers, redirect: "error" });
}
