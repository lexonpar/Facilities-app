import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

function retired() {
  return NextResponse.json(
    {
      code: "endpoint_retired",
      error:
        "Email allowlist management has been retired. Staff access is managed through the 7shifts roster.",
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

export async function GET() {
  return retired();
}

export async function POST() {
  return retired();
}
