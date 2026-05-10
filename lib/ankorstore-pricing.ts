import { prisma } from "@/lib/prisma";
import { applyMarketplaceMarkup, type MarkupConfig, type MarkupType, type RoundingMode } from "@/lib/marketplace-pricing";

export interface AnkorstorePricingConfig {
  wholesale: MarkupConfig;
  retail: MarkupConfig;
  vatRate: number;
}

export async function loadAnkorstorePricingConfig(): Promise<AnkorstorePricingConfig> {
  const keys = [
    "ankorstore_wholesale_markup_type",
    "ankorstore_wholesale_markup_value",
    "ankorstore_wholesale_markup_rounding",
    "ankorstore_retail_markup_type",
    "ankorstore_retail_markup_value",
    "ankorstore_retail_markup_rounding",
    "ankorstore_default_vat_rate",
  ];
  const rows = await prisma.siteConfig.findMany({ where: { key: { in: keys } } });
  const map = new Map(rows.map((r) => [r.key, r.value]));

  const parse = (prefix: string): MarkupConfig => ({
    type: (map.get(`${prefix}_type`) as MarkupType) || "percent",
    value: Number(map.get(`${prefix}_value`)) || 0,
    rounding: (map.get(`${prefix}_rounding`) as RoundingMode) || "none",
  });

  return {
    wholesale: parse("ankorstore_wholesale_markup"),
    retail: parse("ankorstore_retail_markup"),
    vatRate: Number(map.get("ankorstore_default_vat_rate")) || 20,
  };
}

/**
 * Pour un PACK : on calcule le prix unitaire (total ÷ qty), on applique le
 * markup, on arrondit, puis on multiplie par packQuantity. JAMAIS markup sur
 * le total directement (cohérent avec lib/pfs-publish.ts:getPfsUnitPrice).
 */
export function getAnkorstorePackedPrice(
  unitPriceTotal: number,
  packQuantity: number | null,
  saleType: "UNIT" | "PACK",
  markup: MarkupConfig,
): number {
  if (saleType !== "PACK") return applyMarketplaceMarkup(unitPriceTotal, markup);
  const qty = packQuantity && packQuantity > 0 ? packQuantity : 1;
  const perUnit = Math.round((unitPriceTotal / qty) * 100) / 100;
  const withMarkup = applyMarketplaceMarkup(perUnit, markup);
  return Math.round(withMarkup * qty * 100) / 100;
}

/** Convertit un prix en euros vers les centimes attendus par l'API Ankorstore. */
export function toCents(amountEur: number): number {
  return Math.round(amountEur * 100);
}
