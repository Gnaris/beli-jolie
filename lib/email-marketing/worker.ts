/**
 * lib/email-marketing/worker.ts
 *
 * Worker background des scénarios email marketing.
 *
 * Tick toutes les 15 min. Boucle sur les tenants actifs, wrap dans
 * `tenantALS.run(tenantId, …)` pour que Prisma/SMTP résolvent les bons
 * paramètres, et lance chaque scanner (panier abandonné pour l'instant).
 *
 * Idempotent : les scanners posent leurs propres verrous (contrainte unique
 * sur EmailSend). Ré-exécuter n'a pas d'effet secondaire.
 */
import { prisma } from "@/lib/prisma";
import { tenantALS } from "@/lib/tenant-als";
import { logger } from "@/lib/logger";
import { runAbandonedCartScan } from "@/lib/email-marketing/abandoned-cart";
import { runInactiveClientScan } from "@/lib/email-marketing/inactive-client";

const TICK_MS = 15 * 60_000; // 15 min

const GUARD = Symbol.for("beliandjolie.emailMarketingWorker.started");
const g = globalThis as Record<symbol, unknown>;

export function startEmailMarketingWorker(): void {
  if (g[GUARD]) return;
  g[GUARD] = true;

  logger.info("[EmailMarketing] Worker démarré (tick 15 min)");
  // Premier tick 30s après le démarrage pour laisser Next initialiser.
  setTimeout(() => {
    void tick();
    setInterval(() => void tick(), TICK_MS);
  }, 30_000);
}

async function tick(): Promise<void> {
  try {
    const tenants = await prisma.tenant.findMany({
      where: { isActive: true },
      select: { id: true, name: true },
    });

    for (const t of tenants) {
      await tenantALS.run(t.id, async () => {
        try {
          const cart = await runAbandonedCartScan(t.id);
          if (cart.sent > 0 || cart.errors > 0) {
            logger.info("[EmailMarketing] Panier abandonné — résultat", {
              tenantId: t.id,
              tenant: t.name,
              ...cart,
            });
          }
        } catch (err) {
          logger.error("[EmailMarketing] Erreur pendant le scan panier abandonné", {
            tenantId: t.id,
            tenant: t.name,
            error: err as Error,
          });
        }

        // Retour en stock : plus de scan automatique. Le dispatch est
        // piloté manuellement par l'admin depuis le widget flottant, pour
        // éviter le spam (1 email par produit) et laisser la maîtresse
        // choisir le moment (batch groupé par client).

        try {
          const inactive = await runInactiveClientScan(t.id);
          if (inactive.sent > 0 || inactive.errors > 0) {
            logger.info("[EmailMarketing] Client inactif — résultat", {
              tenantId: t.id,
              tenant: t.name,
              ...inactive,
            });
          }
        } catch (err) {
          logger.error("[EmailMarketing] Erreur pendant le scan client inactif", {
            tenantId: t.id,
            tenant: t.name,
            error: err as Error,
          });
        }
      });
    }
  } catch (err) {
    logger.error("[EmailMarketing] Tick worker en erreur", { error: err as Error });
  }
}
