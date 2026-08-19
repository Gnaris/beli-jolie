/**
 * Orderchamp Pricing — calcul des prix (wholesale + retail) avec markup.
 *
 * Miroir de `lib/ankorstore-pricing.ts` :
 *  - Markup wholesale appliqué sur le basePrice BJ
 *  - Markup retail chaîné sur le WHOLESALE déjà majoré (règle métier BJ
 *    figée dans CLAUDE.md — la cliente dit « ×3 sur prix de gros » et ça
 *    doit donner ×3 sur le wholesale, pas ×3 sur le basePrice).
 *  - Arrondi TOUJOURS via centimes entiers (IEEE-754 sinon 4.2 * 3 = 12.6000...1
 *    et le retail dérive d'un cran).
 *  - PACK : markup sur le prix unitaire (total÷qty), arrondi, ×qty.
 *
 * Orderchamp attend les prix en `Money` (accepte string ou number, retourne
 * string "4.50"). Contrairement à Faire/Ankorstore on n'a pas besoin de
 * convertir en centimes — le montant en euros suffit.
 */
import { prisma } from "@/lib/prisma";
import { applyMarketplaceMarkup, type MarkupConfig, type MarkupType, type RoundingMode } from "@/lib/marketplace-pricing";

export interface OrderchampPricingConfig {
  wholesale: MarkupConfig;
  retail: MarkupConfig;
}

export async function loadOrderchampPricingConfig(): Promise<OrderchampPricingConfig> {
  const keys = [
    "orderchamp_wholesale_markup_type",
    "orderchamp_wholesale_markup_value",
    "orderchamp_wholesale_markup_rounding",
    "orderchamp_retail_markup_type",
    "orderchamp_retail_markup_value",
    "orderchamp_retail_markup_rounding",
  ];
  const rows = await prisma.siteConfig.findMany({ where: { key: { in: keys } } });
  const map = new Map(rows.map((r) => [r.key, r.value]));

  const parse = (prefix: string): MarkupConfig => ({
    type: (map.get(`${prefix}_type`) as MarkupType) || "percent",
    value: Number(map.get(`${prefix}_value`)) || 0,
    rounding: (map.get(`${prefix}_rounding`) as RoundingMode) || "none",
  });

  return {
    wholesale: parse("orderchamp_wholesale_markup"),
    retail: parse("orderchamp_retail_markup"),
  };
}

/**
 * Prix de gros à envoyer à Orderchamp (`variant.price`).
 * PACK : total ÷ qty → markup → arrondi → × qty.
 */
export function getOrderchampWholesalePrice(
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

/**
 * Prix conseillé à envoyer à Orderchamp (`variant.msrp`) — chaîné sur le
 * wholesale déjà majoré (règle métier BJ). Voir CLAUDE.md « Retail =
 * markup appliqué sur le WHOLESALE déjà majoré et arrondi ».
 */
export function getOrderchampChainedRetailPrice(
  unitPriceTotal: number,
  packQuantity: number | null,
  saleType: "UNIT" | "PACK",
  wholesaleMarkup: MarkupConfig,
  retailMarkup: MarkupConfig,
): number {
  if (saleType !== "PACK") {
    const wholesale = applyMarketplaceMarkup(unitPriceTotal, wholesaleMarkup);
    return applyMarketplaceMarkup(wholesale, retailMarkup);
  }
  const qty = packQuantity && packQuantity > 0 ? packQuantity : 1;
  const perUnit = Math.round((unitPriceTotal / qty) * 100) / 100;
  const wholesalePerUnit = applyMarketplaceMarkup(perUnit, wholesaleMarkup);
  const retailPerUnit = applyMarketplaceMarkup(wholesalePerUnit, retailMarkup);
  return Math.round(retailPerUnit * qty * 100) / 100;
}
