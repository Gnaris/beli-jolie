import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { notifyPendingOrders } from "@/lib/notifications";
import { logger } from "@/lib/logger";

/**
 * GET /api/cron/order-digest
 *
 * Called by an external cron service every hour (8h–19h).
 * Counts PENDING orders and sends a digest email to admin if any.
 * Protected by CRON_SECRET bearer token.
 */
export async function GET(request: Request) {
  // ── Auth ────────────────────────────────────────────────────────────────────
  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret) {
    const auth = request.headers.get("authorization");
    if (auth !== `Bearer ${cronSecret}`) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
  }

  // ── Hour guard (safety net — cron should already be scheduled correctly) ───
  const hour = new Date().getHours();
  if (hour < 8 || hour > 19) {
    return NextResponse.json({ skipped: true, reason: "outside 8h-19h" });
  }

  try {
    const pendingCount = await prisma.order.count({
      where: { status: "PENDING" },
    });

    if (pendingCount === 0) {
      logger.info("[order-digest] Aucune commande en attente — pas d'email");
      return NextResponse.json({ sent: false, pendingCount: 0 });
    }

    await notifyPendingOrders(pendingCount);

    return NextResponse.json({ sent: true, pendingCount });
  } catch (err) {
    logger.error("[order-digest] Erreur", {
      detail: err instanceof Error ? err.message : String(err),
    });
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
