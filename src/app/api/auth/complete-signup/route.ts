import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

export async function POST() {
  return NextResponse.json(
    {
      code: "authentication_method_retired",
      error:
        "Email and PIN authentication has been retired. Use your 7shifts Punch ID.",
    },
    {
      status: 410,
      headers: {
        "Cache-Control": "private, no-store, max-age=0",
        Expires: "0",
        Pragma: "no-cache",
      },
    },
  );
}
