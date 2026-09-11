import { NextResponse } from "next/server";
import { getStaffToolsOrigin } from "@/lib/config/integrations";
import { PRIVATE_NO_STORE_HEADERS } from "@/lib/http/request-security";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    return NextResponse.redirect(new URL("/", getStaffToolsOrigin()), { status: 303, headers: PRIVATE_NO_STORE_HEADERS });
  } catch {
    return NextResponse.json({ error: "Staff Tools is temporarily unavailable." }, { status: 503, headers: PRIVATE_NO_STORE_HEADERS });
  }
}
