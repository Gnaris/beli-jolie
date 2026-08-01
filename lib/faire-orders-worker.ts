/**
 * Faire Orders Worker — Polling automatique toutes les 5 minutes des nouvelles
 * commandes Faire.
 *
 * Pour chaque tenant actif ayant une clé API Faire configurée (SiteConfig
 * `faire_api_key`), on appelle `syncRecentFaireOrders` qui lit la page 1
 * (50 dernières) et re-synchronise uniquement les commandes nouvelles ou dont
 * `updated_at`/`state` ont changé.
 *
 * Démarré une seule fois au boot via `instrumentation-node.ts`.
 *
 * Faire NE FOURNIT PAS de webhook (confirmé 2026-06-15) — le polling est le
 * seul mode disponible pour détecter les nouvelles commandes.
 */
import { prisma } from "@/lib/prisma";
import { logger } from "@/lib/logger";
import { tenantALS } from "@/lib/tenant-als";
import { syncRecentFaireOrders } from "@/lib/faire-orders-sync";
import { isMarketplaceAutoSyncEnabled } from "@/lib/marketplace-auto-sync";

const TICK_INTERVAL_MS = 5 * 60_000; // 5 minutes
const START_DELAY_MS = 30_000; // Laisser le serveur finir de démarrer (30s pour ne pas taper 4 APIs en même temps)

const STARTUP_GUARD = Symbol.for("beliandjolie.faireOrdersWorker.started");
const g = globalThis as Record<symbol, unknown>;

async function tenantHasFaireCreds(tenantId: string): Promise<boolean> {
  const row = await prisma.siteConfig.findFirst({
    where: { tenantId, key: "faire_api_key" },
    select: { value: true },
  });
  return (row?.value || "").trim().length > 0;
}

async function persistLastSyncedAt(tenantId: string): Promise<void> {
  await prisma.siteConfig.upsert({
    where: { tenantId_key: { tenantId, key: "faire_orders_last_synced_at" } },
    update: { value: String(Date.now()) },
    create: { tenantId, key: "faire_orders_last_synced_at", value: String(Date.now()) },
  });
}

async function tick(): Promise<void> {
  try {
    const tenants = await prisma.tenant.findMany({
      where: { isActive: true },
      select: { id: true, name: true },
    });
    for (const t of tenants) {
      try {
        const hasCreds = await tenantHasFaireCreds(t.id);
        if (!hasCreds) continue;
        // Skip silencieux si la cliente a désactivé l'auto-sync Faire pour ce tenant
        if (!(await isMarketplaceAutoSyncEnabled(t.id, "FAIRE"))) continue;
        await tenantALS.run(t.id, async () => {
          const res = await syncRecentFaireOrders(t.id);
          if (res.created > 0 || res.updated > 0) {
            logger.info("[Faire Orders] Sync tenant", {
              tenantId: t.id,
              tenant: t.name,
              created: res.created,
              updated: res.updated,
              scanned: res.scanned,
            });
          }
          await persistLastSyncedAt(t.id);
        });
      } catch (err) {
        logger.warn("[Faire Orders] Sync tenant échouée", {
          tenantId: t.id,
          error: err,
        });
      }
    }
  } catch (err) {
    logger.error("[Faire Orders] Tick global échoué", { error: err as Error });
  }
}

export function startFaireOrdersWorker(): void {
  if (g[STARTUP_GUARD]) return;
  g[STARTUP_GUARD] = true;
  logger.info("[Faire Orders] Worker démarré (tick 5 min)");
  setTimeout(() => {
    void tick();
    setInterval(() => {
      void tick();
    }, TICK_INTERVAL_MS);
  }, START_DELAY_MS);
}
