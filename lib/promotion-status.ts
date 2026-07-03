/**
 * Statut effectif d'une promotion à un instant T.
 *
 * `isActive` en BDD est le toggle manuel choisi par l'admin. Le statut affiché
 * dans la liste combine ce toggle avec les dates de validité et le compteur
 * d'utilisations pour éviter que la cliente ait à faire le calcul de tête.
 */

export type PromotionStatusInput = {
  isActive: boolean;
  startsAt: Date | string;
  endsAt: Date | string | null;
  maxUses: number | null;
  currentUses: number;
};

export type EffectivePromotionStatus =
  | "ACTIVE"     // Prête à être utilisée par les clients
  | "SCHEDULED"  // Toggle ON mais startsAt dans le futur
  | "EXPIRED"    // endsAt passé
  | "EXHAUSTED"  // maxUses atteint
  | "INACTIVE";  // Toggle OFF manuellement

export function effectivePromotionStatus(
  promo: PromotionStatusInput,
  now: Date = new Date(),
): EffectivePromotionStatus {
  if (!promo.isActive) return "INACTIVE";

  const starts = promo.startsAt instanceof Date ? promo.startsAt : new Date(promo.startsAt);
  if (now < starts) return "SCHEDULED";

  if (promo.endsAt) {
    const ends = promo.endsAt instanceof Date ? promo.endsAt : new Date(promo.endsAt);
    if (now > ends) return "EXPIRED";
  }

  if (promo.maxUses != null && promo.currentUses >= promo.maxUses) return "EXHAUSTED";

  return "ACTIVE";
}

/**
 * Progression d'utilisation (0..1). Retourne `null` si la promotion est
 * illimitée — dans ce cas il n'y a pas de barre à afficher.
 */
export function usageProgress(current: number, maxUses: number | null): number | null {
  if (maxUses == null || maxUses <= 0) return null;
  return Math.min(1, Math.max(0, current / maxUses));
}

/**
 * Tonalité de la barre de progression selon l'avancement.
 * - < 60 %  : neutre (dégradé ardoise)
 * - 60-89 % : warn (ambre)
 * - >= 90 % : ok (vert — succès de la promotion)
 */
export function progressTone(ratio: number | null): "neutral" | "warn" | "ok" {
  if (ratio == null) return "neutral";
  if (ratio >= 0.9) return "ok";
  if (ratio >= 0.6) return "warn";
  return "neutral";
}

/**
 * Format d'affichage de la remise pour le "coupon" à gauche des cartes.
 * Retourne la valeur principale et un libellé court.
 */
export function formatDiscountDisplay(
  kind: "PERCENTAGE" | "FIXED_AMOUNT" | "FREE_SHIPPING",
  value: number,
): { main: string; unit: string; isText: boolean } {
  if (kind === "FREE_SHIPPING") {
    return { main: "Livraison", unit: "offerte", isText: true };
  }
  if (kind === "PERCENTAGE") {
    return { main: `-${Math.round(value)}%`, unit: "Remise", isText: false };
  }
  const rounded = Number.isInteger(value) ? String(value) : value.toFixed(2).replace(".", ",");
  return { main: `-${rounded} €`, unit: "Remise", isText: false };
}
