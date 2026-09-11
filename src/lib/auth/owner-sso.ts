import "server-only";

import {
  getSupabaseAnonKey,
  getSupabaseUrl,
} from "@/lib/supabase/env";
import { getStaffToolsOrigin } from "@/lib/config/integrations";

const BROKER_TIMEOUT_MS = 15_000;
const MAX_BROKER_RESPONSE_BYTES = 16_384;

export type OwnerBrokerResponse = {
  ok?: unknown;
  code?: unknown;
  ticket?: unknown;
  expiresIn?: unknown;
  role?: unknown;
  accessToken?: unknown;
  refreshToken?: unknown;
};

export async function callOwnerBroker(
  body:
    | { action: "owner_handoff_create"; assertion: string }
    | { action: "owner_handoff_exchange"; ticket: string },
) {
  const supabaseUrl = getSupabaseUrl().replace(/\/+$/, "");
  const publishableKey = getSupabaseAnonKey();
  if (!supabaseUrl || !publishableKey) {
    throw new Error("Supabase environment variables are not configured.");
  }

  const response = await fetch(`${supabaseUrl}/functions/v1/facilities-auth`, {
    method: "POST",
    cache: "no-store",
    redirect: "error",
    headers: {
      Accept: "application/json",
      apikey: publishableKey,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(BROKER_TIMEOUT_MS),
  });
  const text = await response.text();
  if (!text || text.length > MAX_BROKER_RESPONSE_BYTES) {
    return { response, body: null };
  }
  try {
    const parsed: unknown = JSON.parse(text);
    return {
      response,
      body:
        parsed !== null && typeof parsed === "object" && !Array.isArray(parsed)
          ? (parsed as OwnerBrokerResponse)
          : null,
    };
  } catch {
    return { response, body: null };
  }
}

export function isStaffToolsOrigin(request: Request) {
  return request.headers.get("origin") === getStaffToolsOrigin();
}

export const OWNER_SSO_NO_STORE_HEADERS = {
  "Cache-Control": "private, no-store",
  "Referrer-Policy": "no-referrer",
  "X-Content-Type-Options": "nosniff",
} as const;
