export const ONPAR_EMAIL_DOMAIN = "onparbar.com";

/** Core team — auto admin on first sign-up. Keep in sync with DB seed in migration 005. */
export const AUTO_ADMIN_LOCAL_PARTS = [
  "marketing",
  "daniel",
  "carlos",
  "derek",
  "events",
  "samantha",
  "facilities",
  "facility",
] as const;

/**
 * Extra @onparbar.com local-parts (sign-up allowed, role = pending until set in Team).
 * Or add via Admin → Team → “Allow new sign-up”.
 */
export const ADDITIONAL_ALLOWED_LOCAL_PARTS: string[] = ["brooke"];

/** Full email addresses outside @onparbar.com allowed to sign up. */
export const ADDITIONAL_ALLOWED_FULL_EMAILS: string[] = [
  "taylorhouseman20@gmail.com",
];

export type AutoAdminLocalPart = (typeof AUTO_ADMIN_LOCAL_PARTS)[number];

export function buildOnparEmail(localPart: string): string {
  return `${localPart.trim().toLowerCase()}@${ONPAR_EMAIL_DOMAIN}`;
}

export function parseLoginIdentifier(input: string): {
  email: string;
  username: string;
} {
  const raw = input.trim().toLowerCase();
  if (raw.includes("@")) {
    return { email: raw, username: raw.split("@")[0] ?? raw };
  }
  return { email: buildOnparEmail(raw), username: raw };
}

export function getEmailLocalPart(email: string): string | null {
  const normalized = email.trim().toLowerCase();
  const [local, domain] = normalized.split("@");
  if (domain !== ONPAR_EMAIL_DOMAIN || !local) return null;
  return local;
}

export function isAutoAdminLocalPart(localPart: string): boolean {
  return (AUTO_ADMIN_LOCAL_PARTS as readonly string[]).includes(
    localPart.toLowerCase(),
  );
}

/** Can create an account (core team + additional list; DB may allow more). */
export function isAllowedOnparEmail(email: string): boolean {
  const local = getEmailLocalPart(email);
  if (!local) return false;
  if (isAutoAdminLocalPart(local)) return true;
  return ADDITIONAL_ALLOWED_LOCAL_PARTS.map((p) => p.toLowerCase()).includes(
    local,
  );
}

/** Sign-up allowlist: @onparbar.com rules plus explicit full emails. */
export function isAllowedSignupEmail(email: string): boolean {
  const normalized = email.trim().toLowerCase();
  if (
    ADDITIONAL_ALLOWED_FULL_EMAILS.map((e) => e.toLowerCase()).includes(
      normalized,
    )
  ) {
    return true;
  }
  return isAllowedOnparEmail(normalized);
}
