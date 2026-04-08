/**
 * SKU generation for ProductColor variants.
 * Format: {reference}_{couleurs}_{UNIT|PACK}_{index}
 * Example: BJ42_DORE-ROUGE-NOIR_UNIT_1
 */

/**
 * Normalize a color name for SKU usage:
 * - Uppercase
 * - Remove accents
 * - Replace spaces/special chars with hyphens
 * - Collapse multiple hyphens
 */
function normalizeColorName(name: string): string {
  return name
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "") // strip accents
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "-") // non-alphanumeric → hyphen
    .replace(/-+/g, "-") // collapse multiple hyphens
    .replace(/^-|-$/g, ""); // trim leading/trailing hyphens
}

/**
 * Build the color part of a SKU from a list of color names.
 * For UNIT: [mainColor, ...subColors]
 * For PACK: all colors from the single PackColorLine
 */
export function buildSkuColorPart(colorNames: string[]): string {
  if (colorNames.length === 0) return "SANS-COULEUR";
  return colorNames.map(normalizeColorName).join("-");
}

/**
 * Generate a full SKU for a variant.
 *
 * @param reference - Product reference (e.g. "BJ42")
 * @param colorNames - Ordered color names (main + sub-colors for UNIT, pack line colors for PACK)
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
