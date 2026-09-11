import { NextResponse } from "next/server";
import { getAuthContext } from "@/lib/auth/server";
import { PRIVATE_NO_STORE_HEADERS } from "@/lib/http/request-security";

export async function GET() {
  const ctx = await getAuthContext();
  if (!ctx) {
    return NextResponse.json(
      { user: null, profile: null },
      { headers: PRIVATE_NO_STORE_HEADERS },
    );
  }
  return NextResponse.json(
    {
      user: { id: ctx.userId, email: ctx.email },
      profile: ctx.profile,
    },
    { headers: PRIVATE_NO_STORE_HEADERS },
  );
}
