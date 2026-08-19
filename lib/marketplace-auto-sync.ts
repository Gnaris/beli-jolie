/**
 * Toggle ON/OFF de la synchro auto par marketplace et par tenant.
 *
 * Chaque worker (`pfs-orders-worker`, `efashion-orders-worker`, etc.) fait
 * `tick()` toutes les 5 min et itère sur les tenants actifs. Avant de sync un
 * tenant, il consulte cette clé — si `false`, il skippe silencieusement.
 *
 * Comportement par défaut : la clé absente vaut `true` (auto activée). Une
 * boutique nouvellement créée démarre avec toutes les autos ON, comme avant.
 *
 * Clés SiteConfig (une par marketplace) :
 *   - pfs_orders_worker_enabled
 *   - efashion_orders_worker_enabled
 *   - ankorstore_orders_worker_enabled
 *   - faire_orders_worker_enabled
 *   - microstore_orders_worker_enabled
 *
 * Valeurs : "true" ou "false" (chaîne).
 */
import { prisma } from "@/lib/prisma";

export type MarketplaceAutoSyncSource =
  | "PFS"
  | "EFASHION"
  | "ANKORSTORE"
  | "FAIRE"
  | "ORDERCHAMP"
  | "MICROSTORE";

const KEY_BY_SOURCE: Record<MarketplaceAutoSyncSource, string> = {
  PFS: "pfs_orders_worker_enabled",
  EFASHION: "efashion_orders_worker_enabled",
  ANKORSTORE: "ankorstore_orders_worker_enabled",
  FAIRE: "faire_orders_worker_enabled",
  ORDERCHAMP: "orderchamp_orders_worker_enabled",
  MICROSTORE: "microstore_orders_worker_enabled",
};

const LAST_SYNCED_KEY_BY_SOURCE: Record<MarketplaceAutoSyncSource, string> = {
  PFS: "pfs_orders_last_synced_at",
  EFASHION: "efashion_orders_last_synced_at",
  ANKORSTORE: "ankorstore_orders_last_synced_at",
  FAIRE: "faire_orders_last_synced_at",
  ORDERCHAMP: "orderchamp_orders_last_synced_at",
  MICROSTORE: "microstore_orders_last_synced_at",
};

/**
 * Renvoie `true` si l'auto-sync est activée pour ce tenant × marketplace.
 * Défaut = `true` (clé absente).
 */
export async function isMarketplaceAutoSyncEnabled(
  tenantId: string,
  source: MarketplaceAutoSyncSource,
): Promise<boolean> {
  const row = await prisma.siteConfig.findFirst({
    where: { tenantId, key: KEY_BY_SOURCE[source] },
    select: { value: true },
  });
  if (!row) return true; // défaut ON
  return row.value !== "false";
}

/**
 * Version bulk : renvoie l'état ON/OFF pour les 5 marketplaces d'un tenant.
 * Défaut ON pour toute clé absente.
 */
export async function getMarketplaceAutoSyncStates(
  tenantId: string,
): Promise<Record<MarketplaceAutoSyncSource, boolean>> {
  const rows = await prisma.siteConfig.findMany({
    where: {
      tenantId,
      key: { in: Object.values(KEY_BY_SOURCE) },
    },
    select: { key: true, value: true },
  });
  const byKey = new Map(rows.map((r) => [r.key, r.value]));
  const out = {} as Record<MarketplaceAutoSyncSource, boolean>;
  for (const src of Object.keys(KEY_BY_SOURCE) as MarketplaceAutoSyncSource[]) {
    out[src] = (byKey.get(KEY_BY_SOURCE[src]) ?? "true") !== "false";
  }
  return out;
}

/**
 * Pose la clé + gère le reset du compteur.
 *
 * Quand la cliente re-active (enabled=true), on remet
 * `*_orders_last_synced_at` à `Date.now()` pour que le compteur
 * « Prochaine auto dans mm:ss » affiche 5:00 (au lieu d'un vieux timestamp
 * qui déclencherait un tick immédiat).
 *
 * Quand elle désactive (enabled=false), on ne touche pas au timestamp — la
 * cliente peut ainsi voir « dernière synchro il y a X min » même auto OFF.
 */
export async function setMarketplaceAutoSyncEnabled(
  tenantId: string,
  source: MarketplaceAutoSyncSource,
  enabled: boolean,
): Promise<void> {
  const key = KEY_BY_SOURCE[source];
  const value = enabled ? "true" : "false";
  await prisma.siteConfig.upsert({
    where: { tenantId_key: { tenantId, key } },
    update: { value },
    create: { tenantId, key, value },
  });
  if (enabled) {
    const lastKey = LAST_SYNCED_KEY_BY_SOURCE[source];
    await prisma.siteConfig.upsert({
      where: { tenantId_key: { tenantId, key: lastKey } },
      update: { value: String(Date.now()) },
      create: { tenantId, key: lastKey, value: String(Date.now()) },
    });
  }
}
