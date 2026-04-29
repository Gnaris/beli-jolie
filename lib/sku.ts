/**
 * SKU generation for ProductColor variants.
 * Format: {reference}_{couleur}_{UNIT|PACK}_{index}
 * UNIT/PACK mono-couleur: BJ42_ROUGE_UNIT_1
 * PACK multi-couleurs: BJ42_ROUGE-BLEU-NOIR_PACK_1
 */

/**
 * Normalize a color name for SKU usage:
 * - Uppercase
 * - Remove accents
 * - Replace spaces/special chars with hyphens
 * - Collapse multiple hyphens
 */
export function normalizeColorName(name: string): string {
  return name
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "") // strip accents
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "-") // non-alphanumeric → hyphen
    .replace(/-+/g, "-") // collapse multiple hyphens
    .replace(/^-|-$/g, ""); // trim leading/trailing hyphens
}

/**
 * Normalize a color name for accent-insensitive matching (e.g. matching
 * "Doré" against a DB color "Dore"). P3-15.
 */
export function normalizeColorNameForMatch(name: string): string {
  return name
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .toLowerCase();
}

/**
 * Build the color part of a SKU from a list of color names.
 * UNIT / PACK mono-couleur: 1 nom. PACK multi-couleurs: N noms (lignes du pack).
 */
export function buildSkuColorPart(colorNames: string[]): string {
  if (colorNames.length === 0) return "SANS-COULEUR";
  return colorNames.map(normalizeColorName).join("-");
}

/**
 * Generate a full SKU for a variant.
 *
 * @param reference - Product reference (e.g. "BJ42")
 * @param colorNames - 1 nom (UNIT / PACK mono) ou N noms (PACK multi-couleurs)
 * @param saleType - "UNIT" or "PACK"
 * @param index - 1-based sequential index across all variants of the product
 */
export function generateSku(
  reference: string,
  colorNames: string[],
  saleType: "UNIT" | "PACK",
  index: number
): string {
  const colorPart = buildSkuColorPart(colorNames);
  return `${reference}_${colorPart}_${saleType}_${index}`;
}
