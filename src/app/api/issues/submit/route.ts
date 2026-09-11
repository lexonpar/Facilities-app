import { NextResponse } from "next/server";
import { isAuthContext, requireStaffAuth } from "@/lib/auth/server";
import { DEPARTMENTS, PRIORITIES } from "@/lib/constants";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_BODY_BYTES = 8_192;
const NO_STORE_HEADERS = { "Cache-Control": "private, no-store" };
const UUID_PATTERN =
  "[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}";
const PHOTO_PATH_PATTERN = new RegExp(
  `^(${UUID_PATTERN})/(${UUID_PATTERN})\\.(?:jpg|jpeg|png|webp|heic|heif)$`,
  "i",
);

type SubmissionBody = {
  comment?: unknown;
  department?: unknown;
  photoPath?: unknown;
  priority?: unknown;
};

function json(body: object, status: number) {
  return NextResponse.json(body, {
    status,
    headers: NO_STORE_HEADERS,
  });
}

function sameOrigin(request: Request) {
  const origin = request.headers.get("origin");
  return origin !== null && origin === new URL(request.url).origin;
}

async function boundedJson(request: Request): Promise<SubmissionBody | null> {
  const contentLength = request.headers.get("content-length");
  if (
    contentLength &&
    (!/^\d+$/.test(contentLength) || Number(contentLength) > MAX_BODY_BYTES)
  ) {
    return null;
  }

  const text = await request.text();
  if (!text || text.length > MAX_BODY_BYTES) return null;

  try {
    const parsed: unknown = JSON.parse(text);
    return parsed !== null && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as SubmissionBody)
      : null;
  } catch {
    return null;
  }
}

export async function POST(request: Request) {
  if (!sameOrigin(request)) {
    return json({ error: "Invalid request origin" }, 403);
  }

  if (!request.headers.get("content-type")?.startsWith("application/json")) {
    return json({ error: "Expected a JSON request" }, 415);
  }

  const body = await boundedJson(request);
  if (!body) return json({ error: "Invalid request" }, 400);

  const auth = await requireStaffAuth();
  if (!isAuthContext(auth)) {
    auth.headers.set("Cache-Control", NO_STORE_HEADERS["Cache-Control"]);
    return auth;
  }

  const department =
    typeof body.department === "string" ? body.department.trim() : "";
  const comment = typeof body.comment === "string" ? body.comment.trim() : "";
  const priority =
    typeof body.priority === "string" ? body.priority.trim() : "";
  const photoPath =
    typeof body.photoPath === "string" ? body.photoPath.trim() : "";
  const photoMatch = PHOTO_PATH_PATTERN.exec(photoPath);

  if (!DEPARTMENTS.some((item) => item.id === department)) {
    return json({ error: "Select a valid location" }, 400);
  }
  if (comment.length < 3 || comment.length > 2_000) {
    return json({ error: "Describe the issue in 3 to 2,000 characters" }, 400);
  }
  if (!PRIORITIES.some((item) => item.id === priority)) {
    return json({ error: "Select a valid priority" }, 400);
  }
  if (!photoMatch || photoMatch[1].toLowerCase() !== auth.userId.toLowerCase()) {
    return json({ error: "Upload a valid issue photo" }, 400);
  }

  const submittedBy =
    auth.profile.display_name?.trim() || auth.profile.username.trim();

  try {
    const supabase = await createClient();
    const { error } = await supabase.from("issues").insert({
      department,
      comment,
      submitted_by: submittedBy,
      submitted_by_profile_id: auth.userId,
      photo_path: photoPath,
      priority,
      status: "open",
      workflow_status: "open",
    });

    if (error) return json({ error: "Could not submit issue" }, 400);
  } catch {
    return json({ error: "Could not submit issue" }, 500);
  }

  return json({ ok: true }, 201);
}
