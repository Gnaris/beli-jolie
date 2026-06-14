import { prisma } from "@/lib/prisma";
import {
  applyMarketplaceMarkup,
  applyFaireMarkupWithClamp,
  type MarkupType,
  type RoundingMode,
  type MarkupConfig,
} from "@/lib/marketplace-pricing-shared";

// Re-exports pour conserver la rétro-compatibilité des imports existants.
export { applyMarketplaceMarkup, applyFaireMarkupWithClamp };
export type { MarkupType, RoundingMode, MarkupConfig };

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

