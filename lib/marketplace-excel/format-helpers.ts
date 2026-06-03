/**
 * Pure formatting helpers shared between marketplace Excel generators.
 *
 * Kept dependency-free (no Prisma, no exceljs) so they can be unit-tested in
 * isolation.
 */

import { applyMarketplaceMarkup, type MarkupConfig } from "@/lib/marketplace-pricing";
import type {
  ExportProduct,
  ExportVariant,
  ExportPackLine,
  ExportVariantSize,
} from "./types";

/**
 * PFS / Efashion size column format. For each size: `<qty>*<ref|name>`.
 * Several sizes are joined by ", " (PFS) or "," (efashion). Caller picks
 * the separator with the `separator` argument.
 *
 * For PACK mono-couleur : aggregated sizes (sum across pack lines).
 * Example outputs : `1*TU`, `12*TU`, `2*S,2*M,2*L`, `6*3A, 12*4A, 12*6A`.
 *
 * `usePfsRef` controls whether to prefer `size.pfsSizeRef` (PFS) over `size.name` (Efashion default).
 */
export function formatSizesQty(
  sizes: ExportVariantSize[],
  separator: string,
  usePfsRef: boolean,
): string {
  return sizes
    .map((s) => {
      const label = usePfsRef ? s.pfsSizeRef || s.name : s.name;
      return `${s.quantity}*${label}`;
    })
    .join(separator);
}

/**
 * Color list joined by ", " (PFS/Efashion). For PACK multi-couleurs, the
 * caller has already populated `variant.colorNames` with one entry per pack
 * line, so a simple join is enough.
 */
export function formatColorList(variant: ExportVariant): string {
  return variant.colorNames.join(", ");
}

/**
 * Composition string for PFS / Microstore : `100% Acier Inoxydable` or
 * `65% Coton - 35% Polyester`.
 */
export function formatCompositionPfs(product: ExportProduct): string {
  return product.compositions
    .map((c) => `${c.percentage}% ${c.name}`)
    .join(" - ");
}

/**
 * Composition string for Efashion : `Acier*100` or `Coton*65,Polyester*35`.
 *
 * Utilise le **libellé eFashion** (mapping local → annexes) en priorité ; sinon
 * la référence PFS ; sinon le nom local. Permet à l'admin de mapper sa
 * composition « Acier Inoxydable » à l'entité eFashion « Acier » sans renommer
 * la composition côté Beli & Jolie.
 */
export function formatCompositionEfashion(product: ExportProduct): string {
  return product.compositions
    .map((c) => {
      const label = c.efashionLabel || c.pfsRef || c.name;
      return `${label}*${c.percentage}`;
    })
    .join(",");
}

/**
 * Compute the unit price (per piece, with marketplace markup applied) for one variant.
 * - UNIT: markup on `unitPrice`.
 * - PACK: markup on `unitPrice / packQuantity` (per-piece). Total for the pack
 *   is reconstructed by the caller if needed (= per-piece × packQuantity).
 *
 * Rationale : marketplaces price by piece, not by pack — and the PACK
 * `unitPrice` in our DB already stores the *total* pack price.
 */
export function variantUnitPriceWithMarkup(
  variant: ExportVariant,
  markup: MarkupConfig,
): number {
  if (variant.saleType === "PACK" && variant.packQuantity && variant.packQuantity > 0) {
    const perPiece = variant.unitPrice / variant.packQuantity;
    return applyMarketplaceMarkup(perPiece, markup);
  }
  return applyMarketplaceMarkup(variant.unitPrice, markup);
}

/**
 * Total pack price = per-piece × pack quantity, applied AFTER markup.
 * For UNIT, identical to `variantUnitPriceWithMarkup`.
 */
export function variantTotalPriceWithMarkup(
  variant: ExportVariant,
  markup: MarkupConfig,
): number {
  const perPiece = variantUnitPriceWithMarkup(variant, markup);
  const qty =
    variant.saleType === "PACK" && variant.packQuantity && variant.packQuantity > 0
      ? variant.packQuantity
      : 1;
  return Math.round(perPiece * qty * 100) / 100;
}

/**
 * Aggregate sizes across all pack lines (multi-color packs) into a single list
 * with summed quantities per size.
 *
 * For non-multi-color variants (`packLines` undefined/empty), returns
 * `variant.sizes` unchanged.
 */
export function aggregatePackSizes(variant: ExportVariant): ExportVariantSize[] {
  if (!variant.packLines || variant.packLines.length === 0) return variant.sizes;
  const map = new Map<string, ExportVariantSize>();
  for (const line of variant.packLines) {
    for (const s of line.sizes) {
      const key = s.name;
      const cur = map.get(key);
      if (cur) cur.quantity += s.quantity;
      else map.set(key, { ...s });
    }
  }
  return [...map.values()];
}

/**
 * Pick a translated value for a given locale.
 *
 * - `fr` : retourne le champ original du produit (langue source).
 * - Autres locales : retourne la traduction si elle existe, sinon **chaîne
 *   vide** (jamais de fallback FR vers les autres langues — la cliente
 *   préfère que la marketplace voie une colonne vide plutôt que du français
 *   inattendu côté ES/DE/IT).
 */
export function pickTranslation(
  product: ExportProduct,
  locale: string,
  field: "name" | "description",
): string {
  if (locale === "fr") return product[field] ?? "";
  const t = product.translations[locale];
  if (t && t[field]) return t[field];
  return "";
}

/**
 * Sluggify a filesystem-friendly token : replace spaces with hyphens,
 * preserve diacritics (Efashion expects names like "Doré"), strip forbidden
 * characters. Useful for image filenames in the ZIP.
 */
export function slugForImageFilename(input: string): string {
  return input
    .replace(/\s+/g, "-")
    .replace(/[/\\:*?"<>|]/g, "")
    .trim();
}

/**
 * Return a copy of the product with only its UNIT variants (PACKs filtered out).
 *
 * Utilisé pour Efashion, Microstore et Ankorstore où la cliente ne veut
 * exporter que les ventes à l'unité (le PACK reste exclusivement PFS).
 *
 * Si aucun UNIT n'existe, le produit retourné a `variants: []` — c'est au
 * validateur de bloquer ce cas, pas à ce helper.
 */
export function withUnitVariantsOnly(product: ExportProduct): ExportProduct {
  return { ...product, variants: product.variants.filter((v) => v.saleType === "UNIT") };
}

// Re-export for convenience.
export { applyMarketplaceMarkup };
export type { ExportPackLine };
