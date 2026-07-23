/**
 * GET /api/admin/emails/live
 *
 * Alimente le widget flottant admin "Emails" avec :
 *   - `sending`  : envois très récents (dernière minute) — proxy de "en cours"
 *   - `queued`   : ce qui va partir au prochain scan / trigger (estimation)
 *                  → panier abandonné éligible, restock alerts pending
 *   - `recent`   : 15 derniers envois pour un feed live
 *
 * Multi-tenant : automatique via l'ALS + headers dans requireAdmin.
 * Refuse si non admin.
 */
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAdmin } from "@/lib/auth-helpers";
import { getAbandonedCartConfig, getOrCreateScenario } from "@/lib/email-marketing/scenarios";
import { getPendingRestockSummary, getPendingRestockList } from "@/lib/email-marketing/back-in-stock";
import { logger } from "@/lib/logger";

export const dynamic = "force-dynamic";

type ScenarioSummary = {
  key: "ABANDONED_CART" | "BACK_IN_STOCK" | "WELCOME" | "NEWSLETTER";
  label: string;
  queued: number;
  /** Nombre de clients qui recevront un email si dispatch (BACK_IN_STOCK uniquement). */
  eligibleClients?: number;
  /** True si un bouton "Envoyer maintenant" est proposé. */
  actionable?: boolean;
};

export async function GET(): Promise<Response> {
  let tenantId: string;
  try {
    const { tenant } = await requireAdmin();
    tenantId = tenant.id;
  } catch {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  try {
    const now = new Date();
    const oneMinuteAgo = new Date(now.getTime() - 60_000);

    const [sending, recent, cartConfig, backInStockScenario] = await Promise.all([
      prisma.emailSend.findMany({
        where: { tenantId, sentAt: { gte: oneMinuteAgo } },
        orderBy: { sentAt: "desc" },
        take: 20,
        select: {
          id: true,
          scenarioKey: true,
          recipientEmail: true,
          subject: true,
          sentAt: true,
        },
      }),
      prisma.emailSend.findMany({
        where: { tenantId },
        orderBy: { sentAt: "desc" },
        take: 15,
        select: {
          id: true,
          scenarioKey: true,
          recipientEmail: true,
          subject: true,
          sentAt: true,
          openedAt: true,
          clickedAt: true,
        },
      }),
      getAbandonedCartConfig(tenantId),
      getOrCreateScenario(tenantId, "BACK_IN_STOCK"),
    ]);

    // ── Queued : Panier abandonné éligibles au prochain scan ────────────────
    // Pour chaque relance configurée, on compte les paniers qui entreraient
    // dans la fenêtre au prochain tick MAIS pour lesquels aucun EmailSend
    // avec ce dedupKey n'existe déjà. On approxime en comptant les paniers
    // dans la bonne fenêtre — la dédup exacte est laissée au worker.
    let cartQueued = 0;
    if (cartConfig.enabled) {
      for (let stageIndex = 0; stageIndex < cartConfig.config.reminders.length; stageIndex += 1) {
        const stage = cartConfig.config.reminders[stageIndex];
        const upperBound = new Date(now.getTime() - stage.afterHours * 3_600_000);
        const lowerBound = new Date(
          now.getTime() - (stage.afterHours + 7 * 24) * 3_600_000,
        );
        const carts = await prisma.cart.findMany({
          where: {
            tenantId,
            updatedAt: { gte: lowerBound, lt: upperBound },
            items: { some: {} },
            user: { status: "APPROVED" },
          },
          select: { id: true },
          take: 200,
        });
        if (carts.length === 0) continue;
        // Filtre : uniquement ceux sans EmailSend pour ce stage.
        const cartIds = carts.map((c) => c.id);
        const dedupKeys = cartIds.map((id) => `cart-${id}:stage-${stageIndex}`);
        const already = await prisma.emailSend.findMany({
          where: {
            tenantId,
            scenarioKey: "ABANDONED_CART",
            dedupKey: { in: dedupKeys },
          },
          select: { dedupKey: true },
        });
        cartQueued += cartIds.length - already.length;
      }
    }

    // ── Queued : Retour en stock (RestockEvent non dispatchés) ────────────
    // On expose distinctProducts + eligibleClients pour que le widget affiche
    // "X produits · Y clients seront notifiés" et propose un bouton
    // "Envoyer maintenant" quand > 0.
    let stockPending = { distinctProducts: 0, eligibleClients: 0 };
    let stockPendingProducts: Awaited<ReturnType<typeof getPendingRestockList>> = [];
    if (backInStockScenario.enabled) {
      const [summary, list] = await Promise.all([
        getPendingRestockSummary(tenantId),
        getPendingRestockList(tenantId),
      ]);
      stockPending = {
        distinctProducts: summary.distinctProducts,
        eligibleClients: summary.eligibleClients,
      };
      stockPendingProducts = list;
    }

    const scenarios: ScenarioSummary[] = [
      { key: "ABANDONED_CART", label: "Panier abandonné", queued: cartQueued },
      {
        key: "BACK_IN_STOCK",
        label: "Retour en stock",
        queued: stockPending.distinctProducts,
        eligibleClients: stockPending.eligibleClients,
        actionable: true,
      },
      // Welcome/Newsletter sont event-driven ou manuels — pas de "queued" pertinent
      { key: "WELCOME", label: "Bienvenue", queued: 0 },
      { key: "NEWSLETTER", label: "Newsletter", queued: 0 },
    ];

    return NextResponse.json({
      sending: sending.map((s) => ({
        id: s.id,
        scenarioKey: s.scenarioKey,
        recipientEmail: s.recipientEmail,
        subject: s.subject,
        sentAt: s.sentAt.toISOString(),
      })),
      recent: recent.map((s) => ({
        id: s.id,
        scenarioKey: s.scenarioKey,
        recipientEmail: s.recipientEmail,
        subject: s.subject,
        sentAt: s.sentAt.toISOString(),
        openedAt: s.openedAt?.toISOString() ?? null,
        clickedAt: s.clickedAt?.toISOString() ?? null,
      })),
      scenarios,
      totalQueued: scenarios.reduce((s, sc) => s + sc.queued, 0),
      backInStockPendingProducts: stockPendingProducts,
    });
  } catch (err) {
    logger.error("[EmailsLive] Échec récupération état", { error: err as Error });
    return NextResponse.json({ error: "internal_error" }, { status: 500 });
  }
}
