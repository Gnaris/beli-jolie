/**
 * Helpers pour détecter les URLs images Ankor qui n'appartiennent pas au
 * produit courant — protection contre la contamination par le bug filters[id]
 * (une sync précédente a pu injecter chez Ankor une URL dont le préfixe pointe
 * vers un autre produit ; sans filtre, cette URL est réutilisée en "keep" à la
 * sync suivante et le produit reste affiché avec l'image d'un autre).
 */

/**
 * Extrait le préfixe numérique d'une URL image Ankor.
 *
 * Format observé : `/products/images/{ankorProductId}-{hash}.{ext}` (image
 * produit-père) ou `/products/images/{ankorProductId}-{variantId}-{hash}.{ext}`
 * (image variante). Le premier segment numérique après `/products/images/` est
 * TOUJOURS l'ID du produit propriétaire.
 *
 * Renvoie `null` si l'URL ne matche pas ce format (URL externe, key upload
 * `file-upload:…`, chaîne vide, etc.) → l'appelant traite comme "URL neutre"
 * (à laisser passer, aucune preuve de contamination).
 */
export function extractAnkorProductIdFromImageUrl(url: string): number | null {
  const m = /^\/products\/images\/(\d+)-/.exec(url);
  return m ? Number(m[1]) : null;
}

/**
 * Renvoie true si l'URL appartient au produit `targetProductId` (ou si son
 * préfixe est indéterminable — on ne rejette jamais une URL qu'on ne sait pas
 * classer).
 */
export function ankorImageBelongsToProduct(
  url: string,
  targetProductId: number,
): boolean {
  const prefix = extractAnkorProductIdFromImageUrl(url);
  return prefix === null || prefix === targetProductId;
}
