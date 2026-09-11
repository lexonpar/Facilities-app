import { getConfiguredSupabaseUrl } from "@/lib/supabase/env";

export const BROWSER_PROFILE_COOKIE = "facilities_browser_profile";
export const BLOCKED_BROWSER_PROFILE = "blocked";
export const SESSION_RESET_CHANNEL = "facilities-session-reset-v1";
export const SESSION_RESET_STORAGE_KEY = "facilities-session-reset-v1";
let resetInitiatedHere = false;

export function browserResetWasInitiatedHere() {
  return resetInitiatedHere;
}

export function notifyBrowserSessionReset() {
  resetInitiatedHere = true;
  try {
    const channel = new BroadcastChannel(SESSION_RESET_CHANNEL);
    channel.postMessage("reset");
    channel.close();
  } catch { /* Storage events provide an independent browser fallback. */ }
  try {
    localStorage.setItem(SESSION_RESET_STORAGE_KEY, String(Date.now()));
  } catch { /* Server profile binding remains authoritative without storage. */ }
}

type CookieOptions = {
  path: string;
  sameSite: "lax";
  httpOnly: boolean;
  secure: boolean;
  maxAge: number;
  expires?: Date;
};
export type SetCookie = (name: string, value: string, options: CookieOptions) => void;

export function isProfileId(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
}

export function browserProfileAllows(binding: string | undefined, userId: string): boolean {
  // Existing devices acquire the binding on their next explicit authentication.
  return binding === undefined || (isProfileId(binding) && binding === userId);
}

export function browserProfileIsBlocked(binding: string | undefined): boolean {
  return binding !== undefined && !isProfileId(binding);
}

export function setBrowserProfile(set: SetCookie, profileId: string) {
  if (profileId !== BLOCKED_BROWSER_PROFILE && !isProfileId(profileId)) {
    throw new Error("Invalid browser profile binding");
  }
  set(BROWSER_PROFILE_COOKIE, profileId, {
    path: "/",
    sameSite: "lax",
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    maxAge: 400 * 24 * 60 * 60,
  });
}

export function supabaseCookieNames(cookies: readonly { name: string }[], url = getConfiguredSupabaseUrl()) {
  let base: string;
  try {
    base = `sb-${new URL(url).hostname.split(".")[0]}-auth-token`;
  } catch {
    return [];
  }
  const bases = [base, `${base}-code-verifier`, `${base}-user`];
  return [...new Set([
    ...bases,
    ...cookies.map(({ name }) => name).filter((name) => bases.some((item) =>
      name === item || (name.startsWith(`${item}.`) && /^\d+$/.test(name.slice(item.length + 1))),
    )),
  ])];
}

export function clearBrowserSession(set: SetCookie, cookies: readonly { name: string }[]) {
  for (const name of supabaseCookieNames(cookies)) {
    set(name, "", {
      path: "/",
      sameSite: "lax",
      httpOnly: false,
      secure: process.env.NODE_ENV === "production",
      expires: new Date(0),
      maxAge: 0,
    });
  }
  setBrowserProfile(set, BLOCKED_BROWSER_PROFILE);
}
