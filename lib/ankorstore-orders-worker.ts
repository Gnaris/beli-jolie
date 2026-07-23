/**
 * Ankorstore Orders Worker — polling automatique toutes les 5 minutes des
 * nouvelles commandes Ankorstore.
 *
 * Pour chaque tenant actif ayant les credentials Ankorstore configurés
 * (SiteConfig `ankors_client_id` + `ankors_client_secret`), on appelle
 * `syncRecentAnkorstoreOrders` qui lit la 1ère page (50 dernières) et
 * re-synchronise uniquement les commandes nouvelles ou dont `updatedAt` a évolué.
 *
 * Démarré une seule fois au boot via `instrumentation-node.ts`.
 */
import { prisma } from "@/lib/prisma";
import { logger } from "@/lib/logger";
import { tenantALS } from "@/lib/tenant-als";
import { syncRecentAnkorstoreOrders } from "@/lib/ankorstore-orders-sync";

const TICK_INTERVAL_MS = 5 * 60_000; // 5 minutes
const START_DELAY_MS = 25_000; // Décalé de PFS pour ne pas rentrer en collision au boot

const STARTUP_GUARD = Symbol.for("beliandjolie.ankorstoreOrdersWorker.started");
const g = globalThis as Record<symbol, unknown>;

async function tenantHasAnkorstoreCreds(tenantId: string): Promise<boolean> {
  const rows = await prisma.siteConfig.findMany({
    where: { tenantId, key: { in: ["ankors_client_id", "ankors_client_secret"] } },
    select: { key: true, value: true },
  });
  const map = new Map(rows.map((r) => [r.key, r.value]));
  const clientId = (map.get("ankors_client_id") || "").trim();
  const clientSecret = (map.get("ankors_client_secret") || "").trim();
  return clientId.length > 0 && clientSecret.length > 0;
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
        const hasCreds = await tenantHasAnkorstoreCreds(t.id);
        if (!hasCreds) continue;
        await tenantALS.run(t.id, async () => {
          try {
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
          } finally {
            // Toujours persister `lastSyncedAt` — même en cas d'échec — pour
            // que le compteur « Prochaine auto dans mm:ss » reparte à zéro
            // après chaque tick. Sinon un échec au 1er tick bloque le timer
            // sur « Jamais » indéfiniment.
            await persistLastSyncedAt(t.id);
          }
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
