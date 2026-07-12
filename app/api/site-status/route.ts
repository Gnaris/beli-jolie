import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import {
  isAutoMaintenanceActive,
  attemptAutoRecovery,
  reportSuccess,
  reportCriticalError,
  isBootGracePeriod,
} from "@/lib/health";
import { logger } from "@/lib/logger";

/**
 * Lightweight endpoint used by middleware to check maintenance mode.
 * Now also detects DB failures and triggers auto-maintenance.
 */
export async function GET(request: Request) {
  // Multi-tenant : le middleware nous passe explicitement le tenantId en query
  // param (car cette route est appelée par un fetch interne où le Host header
  // ne porte pas l'identité de la boutique visiteur). Sans ce param, on lit
  // la row globale (comportement legacy — à durcir en 400 une fois la phase 6
  // finie).
  const url = new URL(request.url);
  const tenantId = url.searchParams.get("tenantId");

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
    const config = tenantId
      ? await prisma.siteConfig.findFirst({
          where: { key: "maintenance_mode", tenantId },
        })
      : await prisma.siteConfig.findFirst({
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
    // Pendant la fenêtre de boot (90s après le démarrage du process), on ne
    // déclenche PAS la maintenance auto : MySQL est peut-être encore en train
    // de redémarrer après un reboot serveur. On annonce "tout va bien" pour
    // ne pas afficher la page rouge aux visiteurs.
    if (isBootGracePeriod()) {
      logger.warn("[site-status] DB unreachable during boot grace period — assuming OK", {
        uptime: process.uptime(),
        error: err,
      });
      return NextResponse.json(
        { maintenance: false, bootGrace: true },
        { headers: { "Cache-Control": "no-store" } }
      );
    }

    // DB is unreachable — report critical error & enter maintenance
    reportCriticalError("site-status");

    logger.error("[site-status] DB unreachable", { error: err });

    return NextResponse.json(
      { maintenance: true, auto: true },
      { headers: { "Cache-Control": "no-store" } }
    );
  }
}
