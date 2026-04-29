import { prisma } from "@/lib/prisma";

export type MarkupType = "percent" | "fixed" | "multiplier";
export type RoundingMode = "none" | "down" | "up";

export interface MarkupConfig {
  type: MarkupType;
  value: number;
  rounding: RoundingMode;
}

export interface AllMarkupConfigs {
  pfs: MarkupConfig;
  ankorstoreWholesale: MarkupConfig;
  ankorstoreRetail: MarkupConfig;
}

/**
 * Apply a marketplace markup to a base price.
 * - percent: basePrice * (1 + value/100)
 * - fixed: basePrice + value
 * Then apply rounding to the nearest euro (integer).
 */
export function applyMarketplaceMarkup(
  basePrice: number,
  config: MarkupConfig
): number {
  if (config.value === 0) return basePrice;

  let price: number;
  switch (config.type) {
    case "percent":
      price = basePrice * (1 + config.value / 100);
      break;
    case "multiplier":
      price = basePrice * config.value;
      break;
    case "fixed":
    default:
      price = basePrice + config.value;
      break;
  }

  // P3-14 — l'intent (cf. comment + tests) est l'arrondi à l'euro entier
  // pour up/down, et 2 décimales pour "none". L'ancien code arrondissait
  // à 0.10€, ce qui ne correspondait ni à un cas ni à l'autre.
  switch (config.rounding) {
    case "down":
      price = Math.floor(price);
      break;
    case "up":
      price = Math.ceil(price);
      break;
    case "none":
    default:
      price = Math.round(price * 100) / 100;
      break;
  }

  return price;
}

/**
 * Load all marketplace markup configs from SiteConfig.
 * Returns defaults (0 markup) for any missing keys.
 */
export async function loadMarketplaceMarkupConfigs(): Promise<AllMarkupConfigs> {
  const keys = [
    "pfs_price_markup_type",
    "pfs_price_markup_value",
    "pfs_price_markup_rounding",
    "ankorstore_wholesale_markup_type",
    "ankorstore_wholesale_markup_value",
    "ankorstore_wholesale_markup_rounding",
    "ankorstore_retail_markup_type",
    "ankorstore_retail_markup_value",
    "ankorstore_retail_markup_rounding",
  ];

  const rows = await prisma.siteConfig.findMany({
    where: { key: { in: keys } },
  });

  const map = new Map(rows.map((r) => [r.key, r.value]));

  function parseConfig(prefix: string): MarkupConfig {
    const type = (map.get(`${prefix}_type`) as MarkupType) || "percent";
    const value = Number(map.get(`${prefix}_value`)) || 0;
    const rounding = (map.get(`${prefix}_rounding`) as RoundingMode) || "none";
    return { type, value, rounding };
  }

  return {
    pfs: parseConfig("pfs_price_markup"),
    ankorstoreWholesale: parseConfig("ankorstore_wholesale_markup"),
    ankorstoreRetail: parseConfig("ankorstore_retail_markup"),
  };
}
