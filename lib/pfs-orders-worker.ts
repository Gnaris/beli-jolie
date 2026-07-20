/**
 * PFS Orders Worker — Polling automatique toutes les 5 minutes des nouvelles
 * commandes Paris Fashion Shop.
 *
 * Pour chaque tenant actif ayant les credentials PFS configurés (SiteConfig
 * `pfs_email` + `pfs_password`), on appelle `syncRecentPfsOrders` qui lit
 * la page 1 (50 dernières) et re-synchronise uniquement les commandes nouvelles
 * ou dont le statut a changé.
 *
 * Démarré une seule fois au boot via `instrumentation-node.ts`.
 */
import { prisma } from "@/lib/prisma";
import { logger } from "@/lib/logger";
import { tenantALS } from "@/lib/tenant-als";
import { syncRecentPfsOrders } from "@/lib/pfs-orders-sync";

const TICK_INTERVAL_MS = 5 * 60_000; // 5 minutes
const START_DELAY_MS = 20_000; // Laisser le serveur finir de démarrer

const STARTUP_GUARD = Symbol.for("beliandjolie.pfsOrdersWorker.started");
const g = globalThis as Record<symbol, unknown>;

async function tenantHasPfsCreds(tenantId: string): Promise<boolean> {
  const rows = await prisma.siteConfig.findMany({
    where: { tenantId, key: { in: ["pfs_email", "pfs_password"] } },
    select: { key: true, value: true },
  });
  const map = new Map(rows.map((r) => [r.key, r.value]));
  const email = (map.get("pfs_email") || "").trim();
  const password = (map.get("pfs_password") || "").trim();
  return email.length > 0 && password.length > 0;
}

async function persistLastSyncedAt(tenantId: string): Promise<void> {
  await prisma.siteConfig.upsert({
    where: { tenantId_key: { tenantId, key: "pfs_orders_last_synced_at" } },
    update: { value: String(Date.now()) },
    create: { tenantId, key: "pfs_orders_last_synced_at", value: String(Date.now()) },
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
        const hasCreds = await tenantHasPfsCreds(t.id);
        if (!hasCreds) continue;
        await tenantALS.run(t.id, async () => {
          const res = await syncRecentPfsOrders(t.id);
          if (res.created > 0 || res.updated > 0) {
            logger.info("[PFS Orders] Sync tenant", {
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
        logger.warn("[PFS Orders] Sync tenant échouée", {
          tenantId: t.id,
          error: err,
        });
      }
    }
  } catch (err) {
    logger.error("[PFS Orders] Tick global échoué", { error: err as Error });
  }
}

export function startPfsOrdersWorker(): void {
  if (g[STARTUP_GUARD]) return;
  g[STARTUP_GUARD] = true;
  logger.info("[PFS Orders] Worker démarré (tick 5 min)");
  setTimeout(() => {
    void tick();
    setInterval(() => {
      void tick();
    }, TICK_INTERVAL_MS);
  }, START_DELAY_MS);
}
