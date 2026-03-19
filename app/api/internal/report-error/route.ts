import { NextRequest, NextResponse } from "next/server";
import { reportCriticalError } from "@/lib/health";

/**
 * Internal endpoint called by error boundaries to report critical errors.
 * Not meant to be called by external clients.
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const source = typeof body?.source === "string" ? body.source : "unknown";
    const message = typeof body?.message === "string" ? body.message : "";

    console.error(`[report-error] Error from ${source}: ${message}`);

    const triggered = reportCriticalError(source);

    return NextResponse.json({
      received: true,
      maintenanceTriggered: triggered,
    });
  } catch {
    // Even if parsing fails, still report the error
    reportCriticalError("report-error-endpoint");
    return NextResponse.json({ received: true });
  }
}
