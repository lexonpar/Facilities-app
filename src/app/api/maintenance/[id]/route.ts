import { NextResponse } from "next/server";
import { isAuthContext, requireManagerAuth } from "@/lib/auth/server";
import {
  isJsonRequest,
  isSameOriginRequest,
  PRIVATE_NO_STORE_HEADERS,
} from "@/lib/http/request-security";
import { createClient } from "@/lib/supabase/server";
import type { MaintenanceUpdatePayload } from "@/lib/types/maintenance";

const FIELDS = [
  "title",
  "next_service_date",
  "frequency_label",
  "last_serviced_date",
  "company",
  "poc_name",
  "poc_phone",
  "email",
  "monthly_cost",
  "account_number",
  "notes",
] as const;

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
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

  const auth = await requireManagerAuth();
  if (!isAuthContext(auth)) return auth;

  const { id } = await params;
  const body = (await request.json()) as MaintenanceUpdatePayload;

  const update: Record<string, string | null> = {};
  for (const key of FIELDS) {
    if (key in body) {
      const val = body[key];
      update[key] = val === "" ? null : (val ?? null);
    }
  }

  if (Object.keys(update).length === 0) {
    return NextResponse.json({ error: "No fields to update" }, { status: 400 });
  }

  if ("title" in update && (!update.title || update.title.trim().length < 2)) {
    return NextResponse.json({ error: "Title is required" }, { status: 400 });
  }

  const supabase = await createClient();

  const { data, error } = await supabase
    .from("maintenance_items")
    .update(update)
    .eq("id", id)
    .select()
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 400 });
  }

  return NextResponse.json({ item: data });
}
