/**
 * Shared label helpers for the PFS ZIP image filenames.
 *
 * Kept dependency-free so tests can import it without pulling prisma or storage.
 *
 * PFS-only by design — image folder ships in the ZIP for PFS's manual upload.
 */

import type { ExportProduct } from "./types";

/**
 * Label used for a variant in PFS image filenames.
 * Single color for UNIT/PACK mono ; concaténation pour PACK multi-couleurs.
 */
export function variantColorSlug(product: ExportProduct, idx: number): string {
  const v = product.variants[idx];
  if (!v) return `v${idx + 1}`;
  return v.colorNames.join(" ") || `v${idx + 1}`;
}

/**
 * PFS-friendly color token for a filename: collapse all whitespace so
 * "Bleu Irisé" becomes "BleuIrisé". Diacritics and casing are preserved
 * so the PFS team can recognize their own reference labels. Filesystem-
 * unsafe characters and underscores are stripped — PFS expects
 * "reference couleur position" with no underscore anywhere.
 */
export function formatPfsColorForFilename(input: string): string {
  const stripped = input
    .replace(/\s+/g, "")
    .replace(/[/\\:*?"<>|_]/g, "")
    .trim();
  return stripped.slice(0, 80) || "x";
}

/**
 * PFS reference token for a filename: strip diacritics and any non-alphanumeric
 * character (spaces, underscores, punctuation). PFS expects the reference
 * as a compact alphanumeric token, e.g. "REF-123 A" → "REF123A".
 */
export function formatPfsReferenceForFilename(input: string): string {
  return (
    input
      .normalize("NFD")
      .replace(/[̀-ͯ]/g, "")
      .replace(/[^a-zA-Z0-9]+/g, "")
      .slice(0, 40) || "x"
  );
}

/**
 * Build a PFS image filename in the exact format PFS expects:
 * `<reference> <couleur> <position>.jpg` — three tokens separated by spaces,
 * no underscore anywhere.
 */
export function pfsImageFileName(
  reference: string,
  variantLabel: string,
  imageIdx: number,
): string {
  const refPart = formatPfsReferenceForFilename(reference);
  const colorPart = formatPfsColorForFilename(variantLabel || "x");
  return `${refPart} ${colorPart} ${imageIdx + 1}.jpg`;
}
