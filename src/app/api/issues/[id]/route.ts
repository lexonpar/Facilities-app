import { NextResponse } from "next/server";
import { isAuthContext, requireManagerAuth } from "@/lib/auth/server";
import {
  isJsonRequest,
  isSameOriginRequest,
  PRIVATE_NO_STORE_HEADERS,
} from "@/lib/http/request-security";
import { createClient } from "@/lib/supabase/server";
import type { WorkflowStatus } from "@/lib/types/issue";

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
  const body = (await request.json()) as {
    action: "workflow" | "complete" | "recall";
    workflow_status?: WorkflowStatus;
    completion_note?: string;
  };

  const supabase = await createClient();

  if (body.action === "workflow" && body.workflow_status) {
    const { data, error } = await supabase
      .from("issues")
      .update({
        workflow_status: body.workflow_status,
        status: "open",
      })
      .eq("id", id)
      .select()
      .single();

    if (error) return NextResponse.json({ error: error.message }, { status: 400 });
    return NextResponse.json({ issue: data });
  }

  if (body.action === "complete") {
    const { data, error } = await supabase
      .from("issues")
      .update({
        status: "completed",
        completed_at: new Date().toISOString(),
        completion_note: body.completion_note ?? null,
      })
      .eq("id", id)
      .select()
      .single();

    if (error) return NextResponse.json({ error: error.message }, { status: 400 });
    return NextResponse.json({ issue: data });
  }

  if (body.action === "recall") {
    const { data, error } = await supabase
      .from("issues")
      .update({
        status: "open",
        workflow_status: "open",
        recalled_at: new Date().toISOString(),
        completed_at: null,
        completion_note: null,
      })
      .eq("id", id)
      .select()
      .single();

    if (error) return NextResponse.json({ error: error.message }, { status: 400 });
    return NextResponse.json({ issue: data });
  }

  return NextResponse.json({ error: "Invalid action" }, { status: 400 });
}
