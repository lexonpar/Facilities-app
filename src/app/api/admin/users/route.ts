import { NextResponse } from "next/server";
import {
  ASSIGNABLE_ROLES,
  isAuthContext,
  requireAdminAuth,
} from "@/lib/auth/server";
import {
  isJsonRequest,
  isSameOriginRequest,
  PRIVATE_NO_STORE_HEADERS,
} from "@/lib/http/request-security";
import { createClient } from "@/lib/supabase/server";
import type { UserRole } from "@/lib/types/profile";

function withPrivateNoStore(response: NextResponse) {
  Object.entries(PRIVATE_NO_STORE_HEADERS).forEach(([name, value]) => {
    response.headers.set(name, value);
  });
  return response;
}

export async function GET() {
  const auth = await requireAdminAuth();
  if (!isAuthContext(auth)) return withPrivateNoStore(auth);

  const supabase = await createClient();

  const [profilesResult, ownersResult] = await Promise.all([
    supabase
      .from("profiles")
      .select("*")
      .order("username", { ascending: true }),
    supabase
      .from("facilities_owner_accounts")
      .select("profile_id")
      .eq("owner_source", "staff_tools")
      .eq("active", true),
  ]);

  if (profilesResult.error || ownersResult.error) {
    return NextResponse.json(
      { error: profilesResult.error?.message ?? ownersResult.error?.message },
      { status: 400, headers: PRIVATE_NO_STORE_HEADERS },
    );
  }

  const ownerProfileIds = new Set(
    (ownersResult.data ?? []).map((account) => account.profile_id),
  );
  const users = (profilesResult.data ?? []).map((profile) => ({
    ...profile,
    sign_in_source: ownerProfileIds.has(profile.id)
      ? "staff_tools_owner"
      : "punch",
  }));
  return NextResponse.json(
    { users },
    { headers: PRIVATE_NO_STORE_HEADERS },
  );
}

export async function PATCH(request: Request) {
  if (!isSameOriginRequest(request)) {
    return NextResponse.json(
      { error: "Invalid request origin" },
      { status: 403, headers: PRIVATE_NO_STORE_HEADERS },
    );
  }
  if (!isJsonRequest(request)) {
    return NextResponse.json(
      { error: "Expected a JSON request" },
      { status: 415, headers: PRIVATE_NO_STORE_HEADERS },
    );
  }

  const auth = await requireAdminAuth();
  if (!isAuthContext(auth)) return withPrivateNoStore(auth);

  const body = (await request.json()) as {
    userId?: string;
    role?: UserRole;
    display_name?: string | null;
  };

  if (!body.userId || !body.role) {
    return NextResponse.json(
      { error: "userId and role are required" },
      { status: 400, headers: PRIVATE_NO_STORE_HEADERS },
    );
  }

  if (!ASSIGNABLE_ROLES.includes(body.role)) {
    return NextResponse.json(
      { error: "Invalid role" },
      { status: 400, headers: PRIVATE_NO_STORE_HEADERS },
    );
  }

  if (body.userId === auth.userId && body.role !== "admin") {
    return NextResponse.json(
      { error: "You cannot remove your own admin access" },
      { status: 400, headers: PRIVATE_NO_STORE_HEADERS },
    );
  }

  const supabase = await createClient();
  const { data: ownerAccount, error: ownerLookupError } = await supabase
    .from("facilities_owner_accounts")
    .select("profile_id")
    .eq("profile_id", body.userId)
    .eq("owner_source", "staff_tools")
    .maybeSingle();
  if (ownerLookupError) {
    return NextResponse.json(
      { error: "Could not verify the account source" },
      { status: 400, headers: PRIVATE_NO_STORE_HEADERS },
    );
  }
  if (ownerAccount && body.role !== "admin") {
    return NextResponse.json(
      { error: "The Staff Tools owner account must remain Admin" },
      { status: 400, headers: PRIVATE_NO_STORE_HEADERS },
    );
  }

  const update: Record<string, unknown> = { role: body.role };
  if ("display_name" in body) {
    update.display_name = body.display_name;
  }

  const { data, error } = await supabase
    .from("profiles")
    .update(update)
    .eq("id", body.userId)
    .select()
    .single();

  if (error) {
    return NextResponse.json(
      { error: error.message },
      { status: 400, headers: PRIVATE_NO_STORE_HEADERS },
    );
  }

  return NextResponse.json(
    { user: data },
    { headers: PRIVATE_NO_STORE_HEADERS },
  );
}
