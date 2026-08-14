/**
 * Génération des SKU envoyés à Ankorstore.
 *
 * Format retenu par la cliente (2026-08-14) :
 *
 *   {REFERENCE}_{COULEUR_NORMALISEE}_{5 CHARS ALÉATOIRES}
 *
 * Exemples cibles :
 *   A1555 + "Vert D'eau"          →  A1555_VERT_DEAU_K3M9P
 *   A1555 + "Multicolore - Bleu"  →  A1555_MULTICOLORE_BLEU_X7Y2Q
 *   A1555 + "Doré"                →  A1555_DORE_H4RTZ
 *
 * Pourquoi le suffixe : quand un produit est supprimé/archivé côté Ankorstore,
 * ils gardent le SKU réservé sur la variante archivée. Republier avec le même
 * SKU (« A1555_VERT_DEAU ») échoue avec « SKU already assigned to another
 * product variant ». Le suffixe aléatoire garantit qu'un futur re-publish
 * après suppression fonctionne toujours.
 *
 * Cycle de vie côté ProductColor.ankorsSku :
 *   - 1re publication : `buildAnkorstoreBoSku()` → généré + persisté en BDD
 *   - Update      : SKU relu depuis la BDD (Ankor doit voir la même variante)
 *   - Delete/archive Ankor : `ankorsSku` remis à null → nouveau suffixe au prochain publish
 *
 * Règles de normalisation couleur :
 *   1. Trim + uppercase
 *   2. Retirer les accents (NFD → strip diacritics)
 *   3. Retirer apostrophes et caractères de ponctuation
 *   4. Remplacer les espaces, tirets, slashes, "&", virgules par `_`
 *   5. Compresser les `_` consécutifs
 *   6. Trimer les `_` de début/fin
 *
 * Longueur : max 48 caractères (limite Ankorstore). Si dépassement, on tronque
 * la partie couleur d'abord (jamais le suffixe — nécessaire à l'unicité).
 */

import { randomBytes } from "node:crypto";

/** Longueur maximale d'un SKU acceptée par Ankorstore. */
export const MAX_SKU_LENGTH = 48;

/** Longueur du suffixe aléatoire. */
export const SKU_SUFFIX_LENGTH = 5;

/**
 * Alphabet pour le suffixe : A-Z + 2-9, sans caractères ambigus (O/0/I/1/L)
 * pour éviter les confusions si un humain doit relire un SKU.
 */
const SUFFIX_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";

/**
 * Normalise un libellé de couleur pour l'insérer dans un SKU Ankorstore.
 * Exporté séparément — utile pour tests et aussi côté UI si besoin d'un preview.
 */
export function normalizeColorForSku(color: string): string {
  return (
    color
      .trim()
      .toUpperCase()
      // Retire les diacritiques (é → E, ç → C, ñ → N, œ → OE via handling ci-dessous)
      .normalize("NFD")
      .replace(/[̀-ͯ]/g, "")
      // Ligature latine "Œ"/"œ" ne se décompose pas → on la remplace manuellement
      .replace(/Œ/g, "OE")
      .replace(/Æ/g, "AE")
      // Retire les apostrophes (droite, courbe, backtick), guillemets, points, virgules
      .replace(/['`'".,]/g, "")
      // Remplace séparateurs et symboles par underscore
      .replace(/[\s\-\/&+()]+/g, "_")
      // Retire tout caractère non A-Z, 0-9, _
      .replace(/[^A-Z0-9_]/g, "")
      // Compresse les underscores répétés
      .replace(/_+/g, "_")
      // Trime les underscores de bord
      .replace(/^_+|_+$/g, "")
  );
}

/**
 * Normalise la référence produit BJ. Généralement de la forme A1555, ZC1234…
 * On upper + retire tout ce qui n'est pas alphanumérique. Pas de séparateurs.
 */
export function normalizeReferenceForSku(reference: string): string {
  return reference
    .trim()
    .toUpperCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^A-Z0-9]/g, "");
}

/**
 * Génère un suffixe aléatoire de 5 caractères dans l'alphabet SUFFIX_ALPHABET.
 * ~31^5 = ~28 millions de combinaisons — collision négligeable sur un catalogue < 100k réfs.
 */
export function generateAnkorstoreBoSkuSuffix(): string {
  const bytes = randomBytes(SKU_SUFFIX_LENGTH);
  let out = "";
  for (let i = 0; i < SKU_SUFFIX_LENGTH; i++) {
    out += SUFFIX_ALPHABET[bytes[i] % SUFFIX_ALPHABET.length];
  }
  return out;
}

/**
 * Assemble le SKU final `{REF}_{COULEUR}_{SUFFIXE}` en respectant la limite de longueur.
 *
 * - Si `existingSuffix` est fourni (SKU déjà publié → update), on le réutilise tel quel.
 * - Sinon on génère un nouveau suffixe aléatoire.
 *
 * Si le total dépasse MAX_SKU_LENGTH, la partie couleur est tronquée en premier.
 * Le suffixe n'est JAMAIS tronqué (sinon on casse l'unicité).
 */
export function buildAnkorstoreBoSku(
  reference: string,
  colorName: string,
  existingSuffix?: string | null
): string {
  const ref = normalizeReferenceForSku(reference);
  let col = normalizeColorForSku(colorName);
  const suffix =
    existingSuffix && existingSuffix.length === SKU_SUFFIX_LENGTH
      ? existingSuffix
      : generateAnkorstoreBoSkuSuffix();

  if (!ref) throw new Error("SKU Ankorstore : référence vide après normalisation");
  if (!col) col = "COULEUR"; // fallback sûr si la couleur est vide/exotique

  // On enlève des caractères à la couleur jusqu'à rentrer dans la limite.
  const assemble = (c: string) => `${ref}_${c}_${suffix}`;
  while (assemble(col).length > MAX_SKU_LENGTH && col.length > 3) {
    col = col.slice(0, -1).replace(/_+$/g, "");
  }
  // Fallback extrême : si toujours trop long après troncature couleur, on rogne la ref.
  let localRef = ref;
  let sku = `${localRef}_${col}_${suffix}`;
  while (sku.length > MAX_SKU_LENGTH && localRef.length > 3) {
    localRef = localRef.slice(0, -1);
    sku = `${localRef}_${col}_${suffix}`;
  }
  return sku;
}

