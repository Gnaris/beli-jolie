/**
 * Microstore Orders Worker — Polling automatique toutes les 5 minutes.
 *
 * Pour chaque tenant actif ayant une session Microstore valide, on fait :
 *   1. Page 1 clients (100 plus récents modifiés) via
 *      `syncMicrostoreCustomers({ maxPages: 1 })` → upsert incrémental.
 *   2. Commandes sur la plage `[last_sync-3d ; today]` via
 *      `syncMicrostoreOrders` → upsert incrémental.
 *
 * Les upserts sont idempotents ; si on rate quelque chose (session expirée,
 * réseau), le bouton « Rattrapage » dans le widget déclenche l'import complet.
 *
 * Démarré une seule fois au boot via `instrumentation-node.ts`.
 * Wrappé dans `tenantALS.run(tenantId, …)` pour que la session key et
 * l'extension Prisma tenant-scope trouvent le bon tenant.
 */
import { prisma } from "@/lib/prisma";
import { logger } from "@/lib/logger";
import { tenantALS } from "@/lib/tenant-als";
import { syncMicrostoreOrders } from "@/lib/microstore-orders-sync";
import { syncMicrostoreCustomers } from "@/lib/microstore-customers-sync";
import { MicrostoreSessionExpiredError } from "@/lib/microstore-client";
import { setSiteConfig } from "@/lib/site-config-write";
import { isMarketplaceAutoSyncEnabled } from "@/lib/marketplace-auto-sync";

const TICK_INTERVAL_MS = 5 * 60_000; // 5 minutes
const START_DELAY_MS = 20_000;

const STARTUP_GUARD = Symbol.for("beliandjolie.microstoreOrdersWorker.started");
const g = globalThis as Record<symbol, unknown>;

/** True si le tenant a une session Microstore configurée (clé non vide). */
async function tenantHasMicrostoreSession(tenantId: string): Promise<boolean> {
  const row = await prisma.siteConfig.findFirst({
    where: { tenantId, key: "microstore_session_key" },
    select: { value: true },
  });
  return !!(row?.value && row.value.trim().length > 0);
}

/**
 * Sync incrémental un tenant :
 *   - 1 page clients (100 plus récents)
 *   - Commandes sur [last_sync - 3j, today]
 *
 * Ne remonte jamais d'exception vers le tick global — logue et continue.
 * Session expirée → warn + skip (l'admin doit re-scanner un QR).
 */
async function syncOneTenant(tenantId: string, tenantName: string): Promise<void> {
  await tenantALS.run(tenantId, async () => {
    // 1. Clients (page 1 uniquement)
    try {
      const res = await syncMicrostoreCustomers({ tenantId, maxPages: 1 });
      if (res.created > 0 || res.updated > 0) {
        logger.info("[Microstore Orders] Sync clients tenant", {
          tenantId,
          tenant: tenantName,
          created: res.created,
          updated: res.updated,
          total: res.total,
        });
      }
    } catch (err) {
      if (err instanceof MicrostoreSessionExpiredError) {
        logger.warn("[Microstore Orders] Session expirée (clients)", {
          tenantId,
          tenant: tenantName,
        });
        return; // pas la peine d'enchaîner sur les commandes
      }
      logger.warn("[Microstore Orders] Sync clients échouée", {
        tenantId,
        tenant: tenantName,
        error: err,
      });
    }

    // 2. Commandes (fenêtre glissante 3 jours)
    try {
      const lastSyncRow = await prisma.siteConfig.findFirst({
        where: { tenantId, key: "microstore_orders_last_synced_at" },
        select: { value: true },
      });
      const lastSyncMs = lastSyncRow?.value ? Number(lastSyncRow.value) : 0;
      const from = lastSyncMs
        ? new Date(lastSyncMs - 3 * 86400_000)
        : new Date(Date.now() - 30 * 86400_000);
      const fromDate = from.toISOString().substring(0, 10);
      const toDate = new Date().toISOString().substring(0, 10);

      const res = await syncMicrostoreOrders({ tenantId, fromDate, toDate });
      await setSiteConfig("microstore_orders_last_synced_at", String(Date.now()));
      if (res.created > 0 || res.updated > 0) {
        logger.info("[Microstore Orders] Sync commandes tenant", {
          tenantId,
          tenant: tenantName,
          created: res.created,
          updated: res.updated,
          fromDate,
          toDate,
        });
      }
    } catch (err) {
      if (err instanceof MicrostoreSessionExpiredError) {
        logger.warn("[Microstore Orders] Session expirée (commandes)", {
          tenantId,
          tenant: tenantName,
        });
        return;
      }
      logger.warn("[Microstore Orders] Sync commandes échouée", {
        tenantId,
        tenant: tenantName,
        error: err,
      });
    }
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
        if (!(await tenantHasMicrostoreSession(t.id))) continue;
        // Skip silencieux si la cliente a désactivé l'auto-sync Microstore pour ce tenant
        if (!(await isMarketplaceAutoSyncEnabled(t.id, "MICROSTORE"))) continue;
        await syncOneTenant(t.id, t.name);
      } catch (err) {
        logger.warn("[Microstore Orders] Sync tenant échouée", {
          tenantId: t.id,
          error: err,
        });
      }
    }
  } catch (err) {
    logger.error("[Microstore Orders] Tick global échoué", { error: err as Error });
  }
}

export function startMicrostoreOrdersWorker(): void {
  if (g[STARTUP_GUARD]) return;
  g[STARTUP_GUARD] = true;
  logger.info("[Microstore Orders] Worker démarré (tick 5 min)");
  setTimeout(() => {
    void tick();
    setInterval(() => {
      void tick();
    }, TICK_INTERVAL_MS);
  }, START_DELAY_MS);
}
