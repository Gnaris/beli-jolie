/**
 * lib/platform-config.ts
 *
 * Configuration plateforme — hors tenant. Contrôlée depuis la boutique
 * « maîtresse » (Beli & Jolie via `/admin/plateforme`), mais s'applique à
 * TOUS les tenants.
 *
 * Aujourd'hui : uniquement 4 flags de maintenance marketplaces.
 * Demain : autres interrupteurs qui doivent affecter toutes les boutiques
 * (mode maintenance global, bannière, imports en pause, etc.).
 *
 * Contrairement à SiteConfig, PlatformConfig n'a pas de tenantId. Il faut donc
 * TOUJOURS lire/écrire via ce module (pas de raccourci `prisma.platformConfig.*`
 * ailleurs dans le code — ça garantit qu'on reste au courant si on ajoute
 * un jour un cache ou une couche de sécurité).
 */
import { unstable_cache, revalidateTag } from "next/cache";
import { prisma } from "@/lib/prisma";

export const MARKETPLACES = ["pfs", "ankorstore", "efashion", "faire"] as const;
export type MarketplaceKey = (typeof MARKETPLACES)[number];

/** Clés PlatformConfig — cadrées ici pour éviter les typos ailleurs. */
export const PLATFORM_KEYS = {
  pfsMaintenance: "marketplace_maintenance_pfs",
  ankorstoreMaintenance: "marketplace_maintenance_ankorstore",
  efashionMaintenance: "marketplace_maintenance_efashion",
  faireMaintenance: "marketplace_maintenance_faire",
} as const;

export type MarketplaceMaintenance = Record<MarketplaceKey, boolean>;

const CACHE_TAG = "platform-config";

/**
 * Lecture directe (bypass cache) — utilisée par la page de contrôle plateforme
 * pour afficher l'état à jour immédiatement après un toggle.
 */
async function readMarketplaceMaintenanceDirect(): Promise<MarketplaceMaintenance> {
  const rows = await prisma.platformConfig.findMany({
    where: {
      key: {
        in: [
          PLATFORM_KEYS.pfsMaintenance,
          PLATFORM_KEYS.ankorstoreMaintenance,
          PLATFORM_KEYS.efashionMaintenance,
          PLATFORM_KEYS.faireMaintenance,
        ],
      },
    },
    select: { key: true, value: true },
  });
  const map = new Map(rows.map((r) => [r.key, r.value]));
  return {
    pfs: map.get(PLATFORM_KEYS.pfsMaintenance) === "true",
    ankorstore: map.get(PLATFORM_KEYS.ankorstoreMaintenance) === "true",
    efashion: map.get(PLATFORM_KEYS.efashionMaintenance) === "true",
    faire: map.get(PLATFORM_KEYS.faireMaintenance) === "true",
  };
}

/**
 * Lecture cachée des 4 flags marketplace. Cache 5 min, invalidé par
 * `revalidateTag("platform-config")` (appelé au sein de `setMarketplaceMaintenance`).
 *
 * IMPORTANT : hors contexte Next.js (scripts CLI, boot instrumentation),
 * `unstable_cache` throw. On retombe alors sur la lecture directe.
 */
const _cachedMarketplaceMaintenance = unstable_cache(
  readMarketplaceMaintenanceDirect,
  ["platform-config", "marketplace-maintenance"],
  { revalidate: 300, tags: [CACHE_TAG] },
);

export async function getMarketplaceMaintenance(): Promise<MarketplaceMaintenance> {
  try {
    return await _cachedMarketplaceMaintenance();
  } catch (err) {
    const msg = err instanceof Error ? err.message : "";
    if (msg.includes("incrementalCache") || msg.includes("unstable_cache")) {
      return readMarketplaceMaintenanceDirect();
    }
    throw err;
  }
}

/** Sucre : est-ce que cette marketplace est en maintenance globale ? */
export async function isMarketplaceInMaintenance(mp: MarketplaceKey): Promise<boolean> {
  const flags = await getMarketplaceMaintenance();
  return flags[mp];
}

/**
 * Toggle un flag maintenance marketplace. Invalide le cache pour que la
 * décision soit effective immédiatement sur tous les tenants.
 */
export async function setMarketplaceMaintenance(
  mp: MarketplaceKey,
  active: boolean,
): Promise<void> {
  const key =
    mp === "pfs"
      ? PLATFORM_KEYS.pfsMaintenance
      : mp === "ankorstore"
        ? PLATFORM_KEYS.ankorstoreMaintenance
        : mp === "efashion"
          ? PLATFORM_KEYS.efashionMaintenance
          : PLATFORM_KEYS.faireMaintenance;

  await prisma.platformConfig.upsert({
    where: { key },
    update: { value: active ? "true" : "false" },
    create: { key, value: active ? "true" : "false" },
  });
  revalidateTag(CACHE_TAG, "default");
}

/**
 * Libellés humains — utilisés dans les messages d'erreur retournés aux
 * boutiques quand une action est bloquée par la maintenance.
 */
export const MARKETPLACE_LABELS: Record<MarketplaceKey, string> = {
  pfs: "Paris Fashion Shop",
  ankorstore: "Ankorstore",
  efashion: "eFashion Paris",
  faire: "Faire",
};

export function marketplaceMaintenanceMessage(mp: MarketplaceKey): string {
  return `${MARKETPLACE_LABELS[mp]} est actuellement en maintenance (opération bloquée par la plateforme).`;
}
