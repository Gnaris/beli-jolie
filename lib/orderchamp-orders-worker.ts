/**
 * Orderchamp Orders Worker — Polling automatique toutes les 5 minutes des
 * nouvelles commandes Orderchamp.
 *
 * Pour chaque tenant actif ayant une clé API Orderchamp configurée (SiteConfig
 * `orderchamp_api_key`), on appelle `syncRecentOrderchampOrders` qui déroule
 * la pagination Relay tant que des commandes récentes existent.
 *
 * Démarré une seule fois au boot via `instrumentation-node.ts`. Kill switch
 * `orderchamp_orders_worker_enabled` respecté (skip silencieux quand OFF).
 *
 * Contrairement à Faire, Orderchamp expose potentiellement des webhooks — mais
 * on reste en polling pour rester cohérent avec les autres marketplaces et
 * éviter la complexité webhook (auth, replay, retries).
 */

import { prisma } from "@/lib/prisma";
import { logger } from "@/lib/logger";
import { tenantALS } from "@/lib/tenant-als";
import { syncRecentOrderchampOrders } from "@/lib/orderchamp-orders-sync";
import { OrderchampGraphQLError } from "@/lib/orderchamp-client";
import { isMarketplaceAutoSyncEnabled } from "@/lib/marketplace-auto-sync";

const TICK_INTERVAL_MS = 5 * 60_000; // 5 minutes
const START_DELAY_MS = 45_000; // Décalage vs Faire (30s) pour ne pas taper 2 APIs en même temps

const STARTUP_GUARD = Symbol.for("beliandjolie.orderchampOrdersWorker.started");
const g = globalThis as Record<symbol, unknown>;

async function tenantHasOrderchampCreds(tenantId: string): Promise<boolean> {
  const row = await prisma.siteConfig.findFirst({
    where: { tenantId, key: "orderchamp_api_key" },
    select: { value: true },
  });
  return (row?.value || "").trim().length > 0;
}

async function persistLastSyncedAt(tenantId: string): Promise<void> {
  await prisma.siteConfig.upsert({
    where: { tenantId_key: { tenantId, key: "orderchamp_orders_last_synced_at" } },
    update: { value: String(Date.now()) },
    create: { tenantId, key: "orderchamp_orders_last_synced_at", value: String(Date.now()) },
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
        const hasCreds = await tenantHasOrderchampCreds(t.id);
        if (!hasCreds) continue;
        if (!(await isMarketplaceAutoSyncEnabled(t.id, "ORDERCHAMP"))) continue;
        await tenantALS.run(t.id, async () => {
          const res = await syncRecentOrderchampOrders(t.id);
          if (res.created > 0 || res.updated > 0) {
            logger.info("[Orderchamp Orders] Sync tenant", {
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
        // 401/403 = clé révoquée ou expirée. Inutile de dumper la stack et de
        // spammer les logs toutes les 5 min — un seul warn compact suffit, la
        // cliente sait déjà que ce tenant a un problème d'auth.
        if (
          err instanceof OrderchampGraphQLError &&
          (err.status === 401 || err.status === 403)
        ) {
          logger.warn("[Orderchamp Orders] Sync ignorée (clé API invalide)", {
            tenantId: t.id,
            tenant: t.name,
          });
          continue;
        }
        logger.warn("[Orderchamp Orders] Sync tenant échouée", {
          tenantId: t.id,
          error: err,
        });
      }
    }
  } catch (err) {
    logger.error("[Orderchamp Orders] Tick global échoué", { error: err as Error });
  }
}

export function startOrderchampOrdersWorker(): void {
  if (g[STARTUP_GUARD]) return;
  g[STARTUP_GUARD] = true;
  logger.info("[Orderchamp Orders] Worker démarré (tick 5 min)");
  setTimeout(() => {
    void tick();
    setInterval(() => {
      void tick();
    }, TICK_INTERVAL_MS);
  }, START_DELAY_MS);
}
