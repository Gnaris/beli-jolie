/**
 * Arrondi monétaire centralisé — aligné sur le logiciel de facturation Sage 50.
 *
 * Règle Sage vérifiée sur facture FA10005485 (2026-09-01) :
 *   • Chaque montant est arrondi au centime le plus proche (round half up).
 *   • La TVA est calculée sur le Net HT déjà arrondi.
 *   • Le TTC est la somme du Net HT et de la TVA — pas de re-arrondi.
 *
 * Historique : jusqu'au 2026-09-01 on utilisait `Math.floor` (arrondi vers le
 * bas) censé aligner sur le logiciel externe ; en pratique Sage arrondit au
 * plus proche, ce qui créait 1 centime d'écart chronique par facture.
 *
 * IEEE-754 : `225.20 * 0.9` vaut 202.6799999… en flottant. `Math.round` seul
 * tomberait à 202.67 alors que Sage donne 202.68. On ajoute `Number.EPSILON`
 * (≈ 2.22e-16) avant l'arrondi pour absorber ces artefacts sans changer le
 * résultat des cas propres.
 */

export function roundCent(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.round((value + Number.EPSILON) * 100) / 100;
}
