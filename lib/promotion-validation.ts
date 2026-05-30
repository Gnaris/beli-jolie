/**
 * Garde-fous bornes numériques pour les promotions (AUDIT 2026-05-29 — point [7]).
 *
 * Extrait des server actions (`promotions.ts` est "use server" et ne peut
 * exporter que des fonctions async). Centralisé pour partager la même règle
 * entre `createPromotion` et `updatePromotion`, et pour pouvoir être testé
 * sans Prisma.
 */

export interface PromotionInputForValidation {
  discountKind: "PERCENTAGE" | "FIXED_AMOUNT" | "FREE_SHIPPING";
  discountValue: number;
  minOrderAmount?: number;
  maxUses?: number;
  maxUsesPerUser?: number;
}

/**
 * Vérifie les bornes d'une promotion.
 * @returns `null` si tout est OK, sinon un message d'erreur en français.
 */
export function validatePromotionInput(
  input: PromotionInputForValidation,
): string | null {
  const v = input.discountValue;
  if (typeof v !== "number" || !Number.isFinite(v) || v < 0) {
    return "La valeur de la remise ne peut pas être négative.";
  }
  if (input.discountKind === "PERCENTAGE" && v > 100) {
    return "Une remise en pourcentage ne peut pas dépasser 100 %.";
  }
  if (input.discountKind !== "FREE_SHIPPING" && v === 0) {
    return "La valeur de la remise doit être supérieure à 0.";
  }
  if (input.minOrderAmount != null) {
    if (!Number.isFinite(input.minOrderAmount) || input.minOrderAmount < 0) {
      return "Le montant minimum de commande ne peut pas être négatif.";
    }
  }
  if (input.maxUses != null) {
    if (!Number.isInteger(input.maxUses) || input.maxUses < 1) {
      return "Le nombre maximum d'utilisations doit être un entier ≥ 1.";
    }
  }
  if (input.maxUsesPerUser != null) {
    if (!Number.isInteger(input.maxUsesPerUser) || input.maxUsesPerUser < 1) {
      return "Le nombre maximum d'utilisations par utilisateur doit être un entier ≥ 1.";
    }
  }
  return null;
}
