/**
 * lib/order-followup-scheduler.ts
 *
 * Scheduler du mail « Suivi 10 j après expédition » (envoi d'avis / relance).
 *
 * Toutes les heures :
 *   1. Liste les tenants actifs.
 *   2. Pour chacun (wrap tenantALS.run) :
 *      - Cherche les Order status=SHIPPED, shippedAt <= now - 10 j,
 *        reviewRequestEmailSentAt IS NULL.
 *      - Pour chaque commande : appelle `sendOrderFollowupReviewEmail`
 *        puis marque `reviewRequestEmailSentAt = now` SI l'envoi a réussi
 *        OU si on a buté sur `already_sent` / `order_not_shipped` (le mail
 *        n'a plus lieu d'être). En cas de `send_failed`, on laisse le
 *        champ null → nouvelle tentative au prochain tick.
 *   3. Batch de 100 commandes max par tenant et par tick (prudent).
 *
 * Kill switch : aucun. Si la cliente veut couper, elle vide le template
 * ORDER_FOLLOWUP_REVIEW (impossible — on revient au défaut) OU on peut
 * ajouter une clé SiteConfig `order_followup_review_enabled` plus tard.
 * Pour l'instant la seule façon de ne pas envoyer est de personnaliser
 * le mail à son goût (puisque la cliente a demandé ce feature elle-même).
 */

import { prisma } from "@/lib/prisma";
import { logger } from "@/lib/logger";
import { tenantALS } from "@/lib/tenant-als";
import { sendOrderFollowupReviewEmail } from "@/lib/order-followup-notify";
import { ORDER_FOLLOWUP_REVIEW_ENABLED_KEY } from "@/lib/order-followup-config";

const TICK_INTERVAL_MS = 60 * 60 * 1000; // 1 h
const START_DELAY_MS = 30 * 1000;        // 30 s après boot (laisser DB et migrations tranquilles)
const DELAY_MS_BEFORE_FOLLOWUP = 10 * 24 * 60 * 60 * 1000; // 10 jours
const MAX_PER_TENANT_PER_TICK = 100;

let started = false;

export function startOrderFollowupScheduler(): void {
  if (started) return;
  started = true;
  logger.info("[orderFollowup] scheduler démarré", {
    tickMs: TICK_INTERVAL_MS,
    delayDays: 10,
  });
  setTimeout(() => {
    void tick();
    setInterval(() => void tick(), TICK_INTERVAL_MS);
  }, START_DELAY_MS);
}

async function tick(): Promise<void> {
  try {
    // Ne considère que les tenants qui ont activé explicitement la relance
    // (kill switch SiteConfig `order_followup_review_enabled` = "true").
    const enabledTenants = await prisma.siteConfig.findMany({
      where: {
        key: ORDER_FOLLOWUP_REVIEW_ENABLED_KEY,
        value: "true",
      },
      select: { tenantId: true },
    });
    if (enabledTenants.length === 0) return;

    for (const { tenantId } of enabledTenants) {
      if (!tenantId) continue;
      try {
        await tenantALS.run(tenantId, () => processTenant(tenantId));
      } catch (err) {
        logger.error("[orderFollowup] tenant tick failed", {
          tenantId,
          error: err as Error,
        });
      }
    }
  } catch (err) {
    logger.error("[orderFollowup] tick failed", { error: err as Error });
  }
}

async function processTenant(tenantId: string): Promise<void> {
  const cutoff = new Date(Date.now() - DELAY_MS_BEFORE_FOLLOWUP);

  const dueOrders = await prisma.order.findMany({
    where: {
      tenantId,
      status: "SHIPPED",
      reviewRequestEmailSentAt: null,
      shippedAt: { lte: cutoff, not: null },
    },
    orderBy: { shippedAt: "asc" },
    take: MAX_PER_TENANT_PER_TICK,
    select: { id: true },
  });

  if (dueOrders.length === 0) return;

  logger.info("[orderFollowup] traitement commandes dues", {
    tenantId,
    count: dueOrders.length,
  });

  for (const o of dueOrders) {
    const result = await sendOrderFollowupReviewEmail(o.id);
    // On marque "envoyé" dans tous les cas sauf send_failed — un envoi raté
    // (SMTP indisponible, config manquante) sera retenté au prochain tick.
    if (result.sent || result.reason !== "send_failed") {
      try {
        await prisma.order.update({
          where: { id: o.id },
          data: { reviewRequestEmailSentAt: new Date() },
        });
      } catch (err) {
        logger.error("[orderFollowup] update marker failed", {
          orderId: o.id,
          error: err as Error,
        });
      }
    }
  }
}
