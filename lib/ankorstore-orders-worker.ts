/**
 * Ankorstore Orders Worker — Polling automatique toutes les 5 minutes des
 * nouvelles commandes Ankorstore (via le back-office reverse-engineered).
 *
 * Pour chaque tenant actif ayant les credentials BO configurés (SiteConfig
 * `ankorstore_bo_email` + `ankorstore_bo_password`), on appelle
 * `syncRecentAnkorstoreOrders` qui lit la page 1 (50 dernières) et re-fetch
 * uniquement les commandes nouvelles ou dont le statut a changé.
 *
 * Démarré une seule fois au boot via `instrumentation-node.ts`.
 */
import { prisma } from "@/lib/prisma";
import { logger } from "@/lib/logger";
import { tenantALS } from "@/lib/tenant-als";
import { syncRecentAnkorstoreOrders } from "@/lib/ankorstore-orders-sync";
import { isMarketplaceAutoSyncEnabled } from "@/lib/marketplace-auto-sync";

const TICK_INTERVAL_MS = 5 * 60_000;
// Décalé de 10 s vs eFashion/PFS pour lisser la charge au boot (session BO à
// établir + on partage le CPU avec l'image queue au démarrage).
const START_DELAY_MS = 35_000;

const STARTUP_GUARD = Symbol.for("beliandjolie.ankorstoreOrdersWorker.started");
const g = globalThis as Record<symbol, unknown>;

async function tenantHasAnkorstoreBoCreds(tenantId: string): Promise<boolean> {
  const rows = await prisma.siteConfig.findMany({
    where: { tenantId, key: { in: ["ankorstore_bo_email", "ankorstore_bo_password"] } },
    select: { key: true, value: true },
  });
  const map = new Map(rows.map((r) => [r.key, r.value]));
  const email = (map.get("ankorstore_bo_email") || "").trim();
  const password = (map.get("ankorstore_bo_password") || "").trim();
  return email.length > 0 && password.length > 0;
}

async function persistLastSyncedAt(tenantId: string): Promise<void> {
  await prisma.siteConfig.upsert({
    where: { tenantId_key: { tenantId, key: "ankorstore_orders_last_synced_at" } },
    update: { value: String(Date.now()) },
    create: { tenantId, key: "ankorstore_orders_last_synced_at", value: String(Date.now()) },
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
        const hasCreds = await tenantHasAnkorstoreBoCreds(t.id);
        if (!hasCreds) continue;
        if (!(await isMarketplaceAutoSyncEnabled(t.id, "ANKORSTORE"))) continue;
        await tenantALS.run(t.id, async () => {
          const res = await syncRecentAnkorstoreOrders(t.id);
          if (res.created > 0 || res.updated > 0) {
            logger.info("[Ankorstore Orders] Sync tenant", {
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
        logger.warn("[Ankorstore Orders] Sync tenant échouée", {
          tenantId: t.id,
          error: err,
        });
      }
    }
  } catch (err) {
    logger.error("[Ankorstore Orders] Tick global échoué", { error: err as Error });
  }
}

export function startAnkorstoreOrdersWorker(): void {
  if (g[STARTUP_GUARD]) return;
  g[STARTUP_GUARD] = true;
  logger.info("[Ankorstore Orders] Worker démarré (tick 5 min)");
  setTimeout(() => {
    void tick();
    setInterval(() => {
      void tick();
    }, TICK_INTERVAL_MS);
  }, START_DELAY_MS);
}
