export const MIN_PER_PAGE = 1;
export const MAX_PER_PAGE = 500;

/**
 * Clamp la saisie utilisateur du nombre d'items par page.
 * Retourne `null` si la valeur n'est pas un nombre exploitable.
 */
export function clampPerPage(raw: string, fallback: number): number | null {
  const n = parseInt(raw, 10);
  if (isNaN(n)) return null;
  const clamped = Math.min(MAX_PER_PAGE, Math.max(MIN_PER_PAGE, n));
  return clamped || fallback;
}
