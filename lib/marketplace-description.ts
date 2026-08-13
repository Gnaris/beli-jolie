/**
 * Helpers de formatage description marketplace, indépendants du module
 * Ankorstore historique.
 */

export const ANKORSTORE_REFERENCE_LINE_PREFIX = "Réf : ";

/**
 * Longueur du suffixe `\n\nRéf : {reference}` qu'on ajoute à la description
 * envoyée aux marketplaces. Sert à calculer si la description brute atteint
 * les 30 chars minimum requis par Ankorstore une fois le suffixe compté.
 */
export function getAnkorstoreReferenceSuffixLength(reference: string): number {
  const ref = (reference ?? "").trim();
  if (!ref) return 0;
  return `\n\n${ANKORSTORE_REFERENCE_LINE_PREFIX}${ref}`.length;
}
