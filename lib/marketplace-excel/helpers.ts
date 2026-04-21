/**
 * Shared label helpers for the PFS ZIP image filenames.
 *
 * Kept dependency-free so tests can import it without pulling prisma or R2.
 *
 * PFS-only by design: Ankorstore embeds image URLs directly in its workbook,
 * so the image folder we ship in the ZIP is for PFS's manual upload only.
 */

import type { ExportProduct, ExportVariant } from "./types";

/**
 * Label used for a variant in PFS image filenames.
 * Honors `pfsColorOverride` when the admin has mapped a multi-color combo
 * to a single canonical PFS color name. Falls back to the concatenation
 * of primary color + sub-colors, or a positional placeholder.
 */
export function variantColorSlug(product: ExportProduct, idx: number): string {
  const v = product.variants[idx];
  if (!v) return `v${idx + 1}`;
  const override = v.pfsColorOverride?.trim();
  if (override) return override;
  return [...v.colorNames, ...v.subColorNames].join("_") || `v${idx + 1}`;
}

/**
 * PFS-friendly color token for a filename: collapse all whitespace so
 * "Bleu Irisé" becomes "BleuIrisé". Diacritics and casing are preserved
 * so the PFS team can recognize their own reference labels. Filesystem-
 * unsafe characters are stripped to keep the archive portable.
 */
export function formatPfsColorForFilename(input: string): string {
  const stripped = input
    .replace(/\s+/g, "")
    .replace(/[/\\:*?"<>|]/g, "")
    .trim();
  return stripped.slice(0, 80) || "x";
}
