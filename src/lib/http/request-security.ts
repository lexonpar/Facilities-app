export const PRIVATE_NO_STORE_HEADERS = {
  "Cache-Control":
    "private, no-cache, no-store, must-revalidate, max-age=0",
  Expires: "0",
  Pragma: "no-cache",
} as const;

export function isSameOriginRequest(request: Request): boolean {
  const origin = request.headers.get("origin");
  if (!origin) return false;

  try {
    return origin === new URL(request.url).origin;
  } catch {
    return false;
  }
}

export function isJsonRequest(request: Request): boolean {
  const contentType = request.headers.get("content-type");
  if (!contentType) return false;

  return contentType.split(";", 1)[0]?.trim().toLowerCase() === "application/json";
}
