/**
 * Résolution du pays de fabrication pour Orderchamp.
 *
 * Orderchamp accepte l'ISO 3166-1 alpha-2 directement (contrairement à Faire
 * qui exige l'alpha-3). Comme notre BDD stocke déjà en alpha-2, on peut
 * envoyer la valeur telle quelle après validation.
 */

const ALPHA2_REGEX = /^[A-Z]{2}$/;

/**
 * Normalise un code ISO alpha-2 (uppercase + trim). Retourne null si le
 * format n'est pas valide (2 lettres). Utilisé avant tout envoi Orderchamp.
 */
export function normalizeOrderchampCountry(
  alpha2: string | null | undefined,
): string | null {
  if (!alpha2) return null;
  const cleaned = alpha2.trim().toUpperCase();
  if (!ALPHA2_REGEX.test(cleaned)) return null;
  return cleaned;
}

/**
 * Résout le pays de fabrication à envoyer à Orderchamp, avec fallback.
 * Par défaut on retombe sur "CN" (le catalogue BJ est majoritairement chinois).
 */
export function resolveOrderchampCountry(
  alpha2: string | null | undefined,
  fallback = "CN",
): string {
  return normalizeOrderchampCountry(alpha2) ?? fallback;
}
