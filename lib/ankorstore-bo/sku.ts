/**
 * Génération des SKU envoyés à Ankorstore.
 *
 * Format retenu par la cliente (2026-08-13) :
 *
 *   {REFERENCE}_{COULEUR_NORMALISEE}
 *
 * Exemples cibles :
 *   A1555 + "Vert D'eau"          →  A1555_VERT_DEAU
 *   A1555 + "Multicolore - Bleu"  →  A1555_MULTICOLORE_BLEU
 *   A1555 + "Doré"                →  A1555_DORE
 *   A1555 + "Écru"                →  A1555_ECRU
 *   A1555 + "Bleu / Vert"         →  A1555_BLEU_VERT
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
 * la partie couleur d'abord, puis la référence.
 */

/** Longueur maximale d'un SKU acceptée par Ankorstore. */
export const MAX_SKU_LENGTH = 48;

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
 * Assemble le SKU final `{REF}_{COULEUR}` en respectant la limite de longueur.
 * Si dépassement, la partie couleur est tronquée en premier.
 */
export function buildAnkorstoreBoSku(reference: string, colorName: string): string {
  const ref = normalizeReferenceForSku(reference);
  let col = normalizeColorForSku(colorName);

  if (!ref) throw new Error("SKU Ankorstore : référence vide après normalisation");
  if (!col) col = "COULEUR"; // fallback sûr si la couleur est vide/exotique

  const total = () => `${ref}_${col}`;

  while (total().length > MAX_SKU_LENGTH && col.length > 3) {
    col = col.slice(0, -1);
    // Nettoie un éventuel underscore final créé par la troncature
    col = col.replace(/_+$/g, "");
  }
  // Si toujours trop long après troncature couleur, on rogne la ref (rare — la ref BJ est courte)
  let sku = total();
  while (sku.length > MAX_SKU_LENGTH) {
    if (col.length > 3) col = col.slice(0, -1);
    else sku = `${ref.slice(0, -1)}_${col}`;
    sku = `${ref}_${col}`;
  }
  return sku;
}
