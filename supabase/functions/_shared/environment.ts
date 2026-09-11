/** Shared by Next.js and the auth broker; never contains private credentials. */
export type FacilitiesEnvironment = Record<string, string | undefined>;

export const PRODUCTION_STAFF_TOOLS_ORIGIN = "https://on-par.vercel.app";
export const PRODUCTION_SHIFTFLOW_ORIGIN = "https://shiftflow-onpar.alexis953849.chatgpt.site";
export const PRODUCTION_OWNER_PUBLIC_KEY =
  "MCowBQYDK2VwAyEA9Eax+GpfN+wgF+j/JF/VoHUk6uUKJq3DkXWfY70uZi8=";
// Verified from the deployed Facilities login page's public client bundle.
export const KNOWN_PRODUCTION_SUPABASE_HOSTNAME = "rzwjremunktgceiojnup.supabase.co";
const PRODUCTION_APPLICATION_HOSTS = new Set([
  new URL(PRODUCTION_STAFF_TOOLS_ORIGIN).hostname,
  new URL(PRODUCTION_SHIFTFLOW_ORIGIN).hostname,
  "on-par-checklists.vercel.app",
  "on-par-preshift-huddle.vercel.app",
  "eventhost-opal.vercel.app",
]);

export class FacilitiesConfigurationError extends Error {
  constructor(setting: string) {
    super(`Facilities configuration is invalid: ${setting}`);
    this.name = "FacilitiesConfigurationError";
  }
}

export function isIsolatedStaging(env: FacilitiesEnvironment) {
  return env.FACILITIES_ISOLATED_STAGING?.trim().toLowerCase() === "true";
}

function supplied(env: FacilitiesEnvironment, name: string) {
  return env[name]?.trim() || "";
}

function aliased(env: FacilitiesEnvironment, primary: string, legacy: string) {
  const current = supplied(env, primary);
  const previous = supplied(env, legacy);
  if (current && previous && validatedOrigin(current, env, primary) !== validatedOrigin(previous, env, legacy)) {
    throw new FacilitiesConfigurationError(primary);
  }
  return current || previous;
}

export function validatedOrigin(value: string, env: FacilitiesEnvironment, setting: string) {
  try {
    const url = new URL(value);
    const authority = /^(https?):\/\/(\[[^\]]+\]|[^/:?#@\\\s]+)(?::\d+)?\/?$/i.exec(value);
    const loopback = ["development", "test"].includes(env.NODE_ENV || "") &&
      ["localhost", "127.0.0.1", "[::1]"].includes(authority?.[2].toLowerCase() || "");
    if (!authority || url.username || url.password || url.pathname !== "/" || url.search || url.hash ||
      (url.protocol !== "https:" && !(loopback && url.protocol === "http:"))) {
      throw new Error("Invalid origin");
    }
    url.hostname = url.hostname.toLowerCase().replace(/\.+$/, "");
    return url.origin;
  } catch {
    throw new FacilitiesConfigurationError(setting);
  }
}

function applicationOrigin(env: FacilitiesEnvironment, value: string, fallback: string, setting: string) {
  if (isIsolatedStaging(env) && !value) throw new FacilitiesConfigurationError(setting);
  const result = validatedOrigin(value || fallback, env, setting);
  if (isIsolatedStaging(env) && PRODUCTION_APPLICATION_HOSTS.has(new URL(result).hostname)) {
    throw new FacilitiesConfigurationError(setting);
  }
  return result;
}

export function staffToolsOrigin(env: FacilitiesEnvironment) {
  return applicationOrigin(env, aliased(env, "STAFF_TOOLS_ORIGIN", "STAFF_TOOLS_SESSION_TRANSITION_ORIGIN"), PRODUCTION_STAFF_TOOLS_ORIGIN, "STAFF_TOOLS_ORIGIN");
}

export function shiftFlowOrigin(env: FacilitiesEnvironment) {
  return applicationOrigin(env, supplied(env, "SHIFTFLOW_ORIGIN"), PRODUCTION_SHIFTFLOW_ORIGIN, "SHIFTFLOW_ORIGIN");
}

function validPublicKey(value: string) {
  try {
    const bytes = atob(value);
    const prefix = [0x30, 0x2a, 0x30, 0x05, 0x06, 0x03, 0x2b, 0x65, 0x70, 0x03, 0x21, 0x00];
    return bytes.length === 44 && btoa(bytes) === value && prefix.every((byte, index) => bytes.charCodeAt(index) === byte);
  } catch { return false; }
}

function publicKey(env: FacilitiesEnvironment, value: string, setting: string) {
  if (!validPublicKey(value) || (isIsolatedStaging(env) && value === PRODUCTION_OWNER_PUBLIC_KEY)) {
    throw new FacilitiesConfigurationError(setting);
  }
  return value;
}

export function ownerPublicKey(env: FacilitiesEnvironment) {
  return publicKey(env, supplied(env, "STAFF_TOOLS_OWNER_PUBLIC_KEY") || PRODUCTION_OWNER_PUBLIC_KEY, "STAFF_TOOLS_OWNER_PUBLIC_KEY");
}

export function transitionPublicKey(env: FacilitiesEnvironment) {
  return publicKey(env, supplied(env, "STAFF_TOOLS_SESSION_TRANSITION_PUBLIC_KEY") || ownerPublicKey(env), "STAFF_TOOLS_SESSION_TRANSITION_PUBLIC_KEY");
}

/** A known production hostname must be supplied; no project reference is guessed. */
export function assertIsolatedSupabase(env: FacilitiesEnvironment, value: string) {
  if (!isIsolatedStaging(env)) return;
  const production = supplied(env, "FACILITIES_PRODUCTION_SUPABASE_HOSTNAME").toLowerCase().replace(/\.+$/, "");
  try {
    const productionUrl = new URL(`https://${production}`);
    if (!production || productionUrl.hostname !== production || productionUrl.origin !== `https://${production}` ||
      !production.includes(".")) throw new Error("Invalid production hostname");
    const candidate = new URL(validatedOrigin(value.replace(/\/+$/, ""), env, "Supabase URL"));
    if (candidate.hostname === productionUrl.hostname || candidate.hostname === KNOWN_PRODUCTION_SUPABASE_HOSTNAME) {
      throw new Error("Production project");
    }
  } catch {
    throw new FacilitiesConfigurationError("isolated Supabase project and production hostname");
  }
}

export function validateIsolatedEnvironment(env: FacilitiesEnvironment, scope: "web" | "broker") {
  if (!isIsolatedStaging(env)) return;
  shiftFlowOrigin(env);
  ownerPublicKey(env);
  assertIsolatedSupabase(env, supplied(env, scope === "web" ? "NEXT_PUBLIC_SUPABASE_URL" : "SUPABASE_URL"));
  if (scope === "web") {
    staffToolsOrigin(env);
    transitionPublicKey(env);
  }
}
