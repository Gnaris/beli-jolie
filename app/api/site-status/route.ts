import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { isAutoMaintenanceActive, attemptAutoRecovery, reportSuccess, reportCriticalError } from "@/lib/health";
import { logger } from "@/lib/logger";

/**
 * Lightweight endpoint used by middleware to check maintenance mode.
 * Now also detects DB failures and triggers auto-maintenance.
 */
export async function GET() {
  // If auto-maintenance is active in memory, try recovery first
  if (isAutoMaintenanceActive()) {
    const recovered = await attemptAutoRecovery();
    if (!recovered) {
      return NextResponse.json(
        { maintenance: true, auto: true },
        { headers: { "Cache-Control": "no-store" } }
      );
    }
  }

  try {
    const config = await prisma.siteConfig.findUnique({
      where: { key: "maintenance_mode" },
    });

    // DB query succeeded — report success to circuit breaker
    reportSuccess();

    const value = config?.value;
    // "true" = manual maintenance, "auto" = auto-triggered
    const isMaintenance = value === "true" || value === "auto";

    return NextResponse.json(
      { maintenance: isMaintenance, auto: value === "auto" },
      {
        headers: {
          "Cache-Control": "public, s-maxage=30",
        },
      }
    );
  } catch (err) {
    // DB is unreachable — report critical error & enter maintenance
    reportCriticalError("site-status");

    logger.error("[site-status] DB unreachable", { error: err instanceof Error ? err.message : String(err) });

    return NextResponse.json(
      { maintenance: true, auto: true },
      { headers: { "Cache-Control": "no-store" } }
    );
  }
}
