/**
 * lib/marketplace-queue-scheduling.ts
 *
 * Utilitaires pour calculer les heures de départ étalées d'un lot de jobs
 * marketplace. Isolé pour être testable sans DB.
 *
 * Règle métier :
 *  - Un produit peut apparaître plusieurs fois dans la liste (1 fois par
 *    marketplace ciblée). Tous les items d'un même produit partagent la même
 *    heure de départ.
 *  - Ordre chronologique = ordre de première apparition du productId dans la
 *    liste. Le 1er produit part immédiatement, le 2e à baseline + intervalMs,
 *    le 3e à baseline + 2 × intervalMs, etc.
 *  - intervalMs ≤ 0 → scheduledFor = null pour tous (démarrage immédiat).
 */

/**
 * Retourne un tableau parallèle à `productIds` : pour chaque item, la date à
 * laquelle il doit être démarré, ou `null` si l'étalement est désactivé.
 *
 * @param productIds Liste des productId dans l'ordre où ils ont été enqueués.
 *                   Peuvent contenir des doublons (un produit × N marketplaces).
 * @param intervalMs Délai en ms entre le départ de chaque produit. ≤ 0 = pas d'étalement.
 * @param baseline   Date de référence pour le 1er produit (utile pour les tests).
 */
export function computeScheduledTimestamps(
  productIds: string[],
  intervalMs: number,
  baseline: Date,
): Array<Date | null> {
  if (intervalMs <= 0 || productIds.length === 0) {
    return productIds.map(() => null);
  }

  // Assigne un index chronologique à chaque productId dans son ordre
  // d'apparition. Les items suivants du même produit héritent du même index.
  const indexByProduct = new Map<string, number>();
  let nextIndex = 0;
  for (const id of productIds) {
    if (!indexByProduct.has(id)) {
      indexByProduct.set(id, nextIndex);
      nextIndex++;
    }
  }

  const baselineMs = baseline.getTime();
  return productIds.map((id) => {
    const idx = indexByProduct.get(id) ?? 0;
    // Le 1er produit garde scheduledFor null (démarrage immédiat).
    // Sinon on positionne à baseline + idx × intervalMs.
    if (idx === 0) return null;
    return new Date(baselineMs + idx * intervalMs);
  });
}
