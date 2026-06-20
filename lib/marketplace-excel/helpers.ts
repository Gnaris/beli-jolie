/**
 * Shared label helpers for the marketplace ZIP image filenames.
 *
 * Kept dependency-free so tests can import it without pulling prisma or storage.
 *
 * Format attendu par chaque marketplace (cf. dossiers d'exemple fournis par la
 * cliente — `C:/.../Script Compression Photo/{Paris Fashion Shop|efashion|images}`) :
 *
 *   PFS         : "<ref> <couleur> <N>.JPG"      → espaces, accents, .JPG majuscule
 *   Efashion    : "<ref>-<couleur>-<N>.JPG"      → tirets, accents, .JPG majuscule
 *   Microstore  : "<ref> <couleur> <N>.JPG"     + remplace "brun" par "Marron"
 *
 * `N` commence à 1 (= `order` BDD + 1) pour les trois marketplaces.
 */

import type { ExportProduct } from "./types";

/**
 * Label used for a variant in image filenames.
 * Single color for UNIT/PACK mono ; concaténation pour PACK multi-couleurs.
 */
export function variantColorSlug(product: ExportProduct, idx: number): string {
  const v = product.variants[idx];
  if (!v) return `v${idx + 1}`;
  return v.colorNames.join(" ") || `v${idx + 1}`;
}

/**
 * Couleur préservée telle quelle, juste nettoyée des caractères interdits
 * sous Windows. Espaces et accents conservés (« Doré », « Bleu Irisé »…).
 */
function cleanColor(input: string): string {
  return input.replace(/[/\\:*?"<>|]/g, "").trim().slice(0, 80) || "x";
}

/**
 * Référence préservée telle quelle (la cliente nomme déjà ses photos avec la
 * référence brute, ex : « A2270 », « E803E »). Juste un nettoyage Windows.
 */
function cleanReference(input: string): string {
  return input.replace(/[/\\:*?"<>|]/g, "").trim().slice(0, 60) || "x";
}

/**
 * "Brun" / "brun" → "Marron" (substitution mot-entier Unicode, insensible à la
 * casse). Utilisé pour la convention de nommage Microstore (cf. script officiel).
 *
 * Lookbehind/lookahead Unicode (`\p{L}`) au lieu de `\b` ASCII : évite de
 * remplacer dans « brunâtre » (le caractère `â` n'est pas un "word boundary"
 * ASCII donc `\bbrun\b` matche à tort).
 */
function brunToMarron(label: string): string {
  return label.replace(/(?<!\p{L})brun(?!\p{L})/giu, "Marron");
}

// ─── PFS ────────────────────────────────────────────────────────────────────

/**
 * Build a PFS image filename : `<reference> <couleur> <position>.JPG` —
 * trois tokens séparés par des espaces, extension JPG en majuscules.
 */
export function pfsImageFileName(
  reference: string,
  variantLabel: string,
  imageIdx: number,
): string {
  const refPart = cleanReference(reference);
  const colorPart = cleanColor(variantLabel || "x");
  return `${refPart} ${colorPart} ${imageIdx + 1}.JPG`;
}

// ─── Efashion ───────────────────────────────────────────────────────────────

/**
 * Build an Efashion image filename : `<reference>-<couleur>-<position>.JPG` —
 * espaces remplacés par des tirets dans les tokens, extension JPG majuscule.
 */
export function efashionImageFileName(
  reference: string,
  variantLabel: string,
  imageIdx: number,
): string {
  const refPart = cleanReference(reference).replace(/\s+/g, "-");
  const colorPart = cleanColor(variantLabel || "x").replace(/\s+/g, "-");
  return `${refPart}-${colorPart}-${imageIdx + 1}.JPG`;
}

// ─── Microstore ─────────────────────────────────────────────────────────────

/**
 * Build a Microstore image filename : `<reference> <couleur> <position>.JPG`,
 * avec « brun » → « Marron » (convention Microstore officielle).
 */
export function microstoreImageFileName(
  reference: string,
  variantLabel: string,
  imageIdx: number,
): string {
  const refPart = cleanReference(reference);
  const colorPart = brunToMarron(cleanColor(variantLabel || "x"));
  return `${refPart} ${colorPart} ${imageIdx + 1}.JPG`;
}
