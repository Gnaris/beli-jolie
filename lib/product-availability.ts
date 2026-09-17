/**
 * Règle métier : un produit ne peut passer OFFLINE → ONLINE que s'il a au
 * moins une variante disponible à la vente (stock > 0 ET non désactivée).
 *
 * Attention à la symétrie : cette règle ne s'applique QUE lors de la mise
 * en ligne (transition ou save d'un brouillon en ONLINE). Un produit déjà
 * ONLINE dont toutes les variantes deviennent OOS/désactivées reste ONLINE
 * — c'est à l'admin de choisir quand le retirer. Cf. rule confirmée par la
 * cliente le 2026-09-17 (« s'ils sont encore en ligne on les laisse en
 * ligne malgré que plus rien n'est disponible »).
 */

export interface AvailabilityVariant {
  stock: number | null | undefined;
  disabled?: boolean;
}

export function hasAvailableVariant(variants: AvailabilityVariant[]): boolean {
  return variants.some(
    (v) => !v.disabled && typeof v.stock === "number" && v.stock > 0,
  );
}

export const NO_AVAILABLE_VARIANT_REASON =
  "Toutes les variantes sont en rupture ou désactivées";
