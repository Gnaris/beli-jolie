import { NextRequest, NextResponse } from "next/server";
import { reportCriticalError } from "@/lib/health";
import { rateLimit } from "@/lib/rate-limit";

/**
 * Internal endpoint called by error boundaries to report critical errors.
 * Rate-limited: max 3 calls per IP per 15 minutes.
 */
export async function POST(request: NextRequest) {
  try {
    const ip = request.headers.get("x-forwarded-for") || "unknown";
    const { success } = rateLimit(`report-error:${ip}`, 3, 15 * 60 * 1000);
    if (!success) {
      return NextResponse.json({ error: "Too many requests." }, { status: 429 });
    }

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
