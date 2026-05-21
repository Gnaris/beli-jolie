/**
 * eFashion Paris — Calcul du prix à envoyer côté eFashion.
 *
 * Applique le markup configuré dans Paramètres > Marketplaces > eFashion
 * (clés SiteConfig `efashion_price_markup_type/value/rounding`).
 *
 * Pour les PACK : markup appliqué au prix UNITAIRE (total/quantité), arrondi,
 * puis × quantité — comme PFS/Ankorstore.
 */

import { prisma } from "@/lib/prisma";
import {
  applyMarketplaceMarkup,
  type MarkupConfig,
  type MarkupType,
  type RoundingMode,
} from "@/lib/marketplace-pricing";

export async function loadEfashionMarkup(): Promise<MarkupConfig> {
  const rows = await prisma.siteConfig.findMany({
    where: {
      key: { in: ["efashion_price_markup_type", "efashion_price_markup_value", "efashion_price_markup_rounding"] },
    },
  });
  const map = new Map(rows.map((r) => [r.key, r.value]));
  return {
    type: (map.get("efashion_price_markup_type") as MarkupType) || "percent",
    value: Number(map.get("efashion_price_markup_value")) || 0,
    rounding: (map.get("efashion_price_markup_rounding") as RoundingMode) || "none",
  };
}

export function computeEfashionPrice(args: {
  basePrice: number;
  isPack: boolean;
  packQuantity: number | null;
  markup: MarkupConfig;
}): number {
  if (args.isPack && args.packQuantity && args.packQuantity > 0) {
    const unit = args.basePrice / args.packQuantity;
    const unitMarked = applyMarketplaceMarkup(unit, args.markup);
    // arrondi à 2 décimales pour éviter les bizarreries de flottants
    return Math.round(unitMarked * args.packQuantity * 100) / 100;
  }
  return applyMarketplaceMarkup(args.basePrice, args.markup);
}
