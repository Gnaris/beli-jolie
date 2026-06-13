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
  efashion: MarkupConfig;
  microstore: MarkupConfig;
  ankorstoreWholesale: MarkupConfig;
  ankorstoreRetail: MarkupConfig;
  ankorstoreVatRate: number;
  faireWholesale: MarkupConfig;
  faireRetail: MarkupConfig;
}

/**
 * Apply a marketplace markup to a base price.
 * - percent: basePrice * (1 + value/100)
 * - fixed: basePrice + value
 * - multiplier: basePrice * value
 * Then apply rounding: up/down arrondit au dixième d'euro (0.10€),
 * none garde 2 décimales.
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

  switch (config.rounding) {
    case "down":
      price = Math.floor(price * 10) / 10;
      break;
    case "up":
      price = Math.ceil(price * 10) / 10;
      break;
    case "none":
    default:
      price = Math.round(price * 100) / 100;
      break;
  }

  return price;
}

const MARKUP_KEYS = [
  "pfs_price_markup_type",
  "pfs_price_markup_value",
  "pfs_price_markup_rounding",
  "efashion_price_markup_type",
  "efashion_price_markup_value",
  "efashion_price_markup_rounding",
  "microstore_price_markup_type",
  "microstore_price_markup_value",
  "microstore_price_markup_rounding",
  "ankorstore_wholesale_markup_type",
  "ankorstore_wholesale_markup_value",
  "ankorstore_wholesale_markup_rounding",
  "ankorstore_retail_markup_type",
  "ankorstore_retail_markup_value",
  "ankorstore_retail_markup_rounding",
  "ankorstore_default_vat_rate",
  "faire_wholesale_markup_type",
  "faire_wholesale_markup_value",
  "faire_wholesale_markup_rounding",
  "faire_retail_markup_type",
  "faire_retail_markup_value",
  "faire_retail_markup_rounding",
];

/**
 * Load all marketplace markup configs from SiteConfig.
 * Returns defaults (0 markup) for any missing keys.
 *
 * Defaults rationale :
 * - pfs / efashion / microstore : 0% (admin configure manuellement)
 * - ankorstoreWholesale : 0% (prix de gros = catalogue)
 * - ankorstoreRetail : ×2.5 arrondi sup (prix conseillé recommandé Ankorstore)
 * - ankorstoreVatRate : 20% (taux standard France)
 */
export async function loadMarketplaceMarkupConfigs(): Promise<AllMarkupConfigs> {
  const rows = await prisma.siteConfig.findMany({
    where: { key: { in: MARKUP_KEYS } },
  });

  const map = new Map(rows.map((r) => [r.key, r.value]));

  function parseConfig(
    prefix: string,
    defaults: MarkupConfig = { type: "percent", value: 0, rounding: "none" }
  ): MarkupConfig {
    const type = (map.get(`${prefix}_type`) as MarkupType) || defaults.type;
    const rawValue = map.get(`${prefix}_value`);
    const value = rawValue !== undefined ? Number(rawValue) : defaults.value;
    const rounding =
      (map.get(`${prefix}_rounding`) as RoundingMode) || defaults.rounding;
    return { type, value: Number.isFinite(value) ? value : defaults.value, rounding };
  }

  return {
    pfs: parseConfig("pfs_price_markup"),
    efashion: parseConfig("efashion_price_markup"),
    microstore: parseConfig("microstore_price_markup"),
    ankorstoreWholesale: parseConfig("ankorstore_wholesale_markup"),
    ankorstoreRetail: parseConfig("ankorstore_retail_markup", {
      type: "multiplier",
      value: 2.5,
      rounding: "up",
    }),
    ankorstoreVatRate: Number(map.get("ankorstore_default_vat_rate")) || 20,
    // Faire impose retail >= 2 x wholesale (l'API rejette sinon). Le default
    // x2.5 sur le retail nous laisse de la marge avant le clamp.
    faireWholesale: parseConfig("faire_wholesale_markup"),
    faireRetail: parseConfig("faire_retail_markup", {
      type: "multiplier",
      value: 2.5,
      rounding: "up",
    }),
  };
}

/**
 * Applique le markup wholesale + retail pour Faire et clamp le retail à
 * au moins 2x le wholesale (contrainte API Faire — rejet sinon).
 * Retourne les deux prix en euros (pas en centimes).
 */
export function applyFaireMarkupWithClamp(
  basePrice: number,
  wholesaleConfig: MarkupConfig,
  retailConfig: MarkupConfig
): { wholesale: number; retail: number } {
  const wholesale = applyMarketplaceMarkup(basePrice, wholesaleConfig);
  let retail = applyMarketplaceMarkup(basePrice, retailConfig);
  const minRetail = wholesale * 2;
  if (retail < minRetail) {
    // Arrondi vers le haut au dixième pour éviter de tomber sous le seuil
    // après arrondi monétaire.
    retail = Math.ceil(minRetail * 10) / 10;
  }
  return { wholesale, retail };
}
