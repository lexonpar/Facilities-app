/** Never forward an authenticated request through an unexpected HTTP redirect. */
export function fetchSupabase(input: RequestInfo | URL, init?: RequestInit) {
  return fetch(input, { ...init, redirect: "error" });
}
