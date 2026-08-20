import { NextResponse } from "next/server";
import {
  loadActiveShiftFlowEmployees,
  ShiftFlowPunchError,
} from "@/lib/auth/shiftflow-punch";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const NO_STORE_HEADERS = { "Cache-Control": "private, no-store" };

export async function GET() {
  try {
    const employees = await loadActiveShiftFlowEmployees();
    return NextResponse.json(
      { ok: true, employees },
      { headers: NO_STORE_HEADERS },
    );
  } catch (error) {
    const failure =
      error instanceof ShiftFlowPunchError
        ? error
        : new ShiftFlowPunchError(
            503,
            "roster_unavailable",
            "The active employee list is temporarily unavailable.",
          );
    return NextResponse.json(
      { ok: false, code: failure.code, error: failure.message },
      { status: failure.status, headers: NO_STORE_HEADERS },
    );
  }
}

