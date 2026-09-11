import "server-only";

const MAX_SESSION_TOKEN_LENGTH = 16_384;

export function isAccessToken(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length >= 20 &&
    value.length <= MAX_SESSION_TOKEN_LENGTH &&
    /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(value)
  );
}

export function isRefreshToken(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length >= 8 &&
    value.length <= MAX_SESSION_TOKEN_LENGTH &&
    /^[\x21-\x7e]+$/.test(value)
  );
}
