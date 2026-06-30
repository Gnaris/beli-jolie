/**
 * Rotation auto de la couleur principale d'un produit.
 *
 * Quand toutes les variantes (non disabled) liées à la couleur principale
 * actuelle tombent à stock=0, on bascule la couleur principale vers la
 * prochaine couleur disponible (au moins une variante en stock).
 *
 * Module pure-logique : aucune dépendance à Prisma / Next / marketplaces.
 * L'orchestration (mise à jour BDD + push marketplaces) est dans
 * `lib/rotate-primary-service.ts`.
 */

export interface VariantForRotation {
  colorId: string | null;
  stock: number;
  disabled: boolean;
}

export type RotationDecision =
  | { rotate: false; reason: "no-primary" | "primary-still-in-stock" | "no-alternative" }
  | { rotate: true; newPrimaryColorId: string };

/**
 * Décide si la couleur principale doit basculer vers une autre.
 *
 * Règles :
 *  - Si pas de primaryColorId → pas de rotation.
 *  - Si au moins une variante non-disabled de la primaryColorId actuelle
 *    a stock > 0 → pas de rotation.
 *  - Sinon, prend la 1ʳᵉ colorId (dans l'ordre des `variants` reçus)
 *    différente de la primary actuelle dont les variantes non-disabled
 *    totalisent un stock > 0.
 *  - Aucune autre couleur disponible → pas de rotation (l'auto-archive
 *    prendra le relais si la totalité du stock est à 0).
 *
 * L'appelant fournit `variants` déjà triés dans l'ordre de priorité souhaité
 * (typiquement `orderBy: { createdAt: "asc" }` côté Prisma).
 */
export function decidePrimaryRotation(
  primaryColorId: string | null | undefined,
  variants: readonly VariantForRotation[],
): RotationDecision {
  if (!primaryColorId) return { rotate: false, reason: "no-primary" };

  const stockByColor = new Map<string, number>();
  const orderedColors: string[] = [];

  for (const v of variants) {
    if (!v.colorId) continue;
    if (v.disabled) continue;
    if (!stockByColor.has(v.colorId)) orderedColors.push(v.colorId);
    stockByColor.set(v.colorId, (stockByColor.get(v.colorId) ?? 0) + v.stock);
  }

  const currentStock = stockByColor.get(primaryColorId) ?? 0;
  if (currentStock > 0) return { rotate: false, reason: "primary-still-in-stock" };

  for (const cid of orderedColors) {
    if (cid === primaryColorId) continue;
    if ((stockByColor.get(cid) ?? 0) > 0) {
      return { rotate: true, newPrimaryColorId: cid };
    }
  }

  return { rotate: false, reason: "no-alternative" };
}
