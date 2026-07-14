import { prisma } from "@/lib/prisma";
import {
  applyMarketplaceMarkup,
  type MarkupConfig,
  type MarkupType,
  type RoundingMode,
} from "@/lib/marketplace-pricing-shared";

const KEYS = [
  "pfs_import_price_markup_type",
  "pfs_import_price_markup_value",
  "pfs_import_price_markup_rounding",
];

const NO_OP: MarkupConfig = { type: "percent", value: 0, rounding: "none" };

/**
 * Charge la majoration à appliquer au prix reçu de PFS lors de l'import initial.
 * Défaut : no-op (0%). Ne concerne PAS le refresh ni la publication vers PFS —
 * ces flux utilisent `loadMarketplaceMarkupConfigs` (`lib/marketplace-pricing.ts`).
 *
 * Toute erreur (SiteConfig indisponible, mock prisma incomplet dans un test)
 * retombe silencieusement sur le no-op — comportement rétrocompatible identique
 * à l'import PFS historique (prix reçu stocké tel quel).
 */
export async function loadPfsImportPriceMarkup(): Promise<MarkupConfig> {
  try {
    const rows = await prisma.siteConfig.findMany({
      where: { key: { in: KEYS } },
    });
    const map = new Map(rows.map((r) => [r.key, r.value]));
    const rawValue = map.get("pfs_import_price_markup_value");
    const value = rawValue !== undefined ? Number(rawValue) : 0;
    return {
      type: (map.get("pfs_import_price_markup_type") as MarkupType) || "percent",
      value: Number.isFinite(value) ? value : 0,
      rounding:
        (map.get("pfs_import_price_markup_rounding") as RoundingMode) || "none",
    };
  } catch {
    return NO_OP;
  }
}

/**
 * Applique le markup d'import à un prix stocké en BDD.
 *
 * - UNIT ou pack de 1 pièce : markup direct sur `unitPrice`.
 * - PACK ≥ 2 pièces : `unitPrice` en BDD représente le TOTAL. On décompose en
 *   prix unitaire (total / qty), on applique le markup, on recompose (×qty).
 *   Convention CLAUDE.md — évite les arrondis étranges sur gros packs.
 */
export function applyImportMarkupToUnitPrice(
  storedUnitPrice: number,
  packQuantity: number | null,
  config: MarkupConfig
): number {
  if (config.value === 0) return storedUnitPrice;
  const qty = packQuantity && packQuantity > 1 ? packQuantity : 1;
  if (qty === 1) return applyMarketplaceMarkup(storedUnitPrice, config);
  const perUnit = storedUnitPrice / qty;
  const adjusted = applyMarketplaceMarkup(perUnit, config);
  return Math.round(adjusted * qty * 100) / 100;
}
