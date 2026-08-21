/**
 * Helpers de calcul utilisés par la modale d'ajout au panier
 * (components/produits/AddToCartModal.tsx).
 * Extraits ici pour être testables sans monter le DOM/next-intl/next-auth.
 */

export interface CartVariant {
  id: string;
  saleType: "UNIT" | "PACK";
  packQuantity: number | null;
  unitPrice: number;
  stock: number;
}

export interface CartColor {
  variants: CartVariant[];
}

export interface ClientDiscount {
  discountType: "PERCENT" | "AMOUNT";
  discountValue: number;
}

/** Prix par unité : UNIT = prix direct, PACK = total ÷ quantité du pack. */
export function pricePerUnit(v: CartVariant): number {
  const p = Number(v.unitPrice);
  if (v.saleType === "PACK" && v.packQuantity && v.packQuantity > 0) {
    return p / v.packQuantity;
  }
  return p;
}

/**
 * Applique la cascade produit (remise fiche + promo AUTO déjà résolue en amont
 * dans `productDiscountPercent`). La remise commerciale client n'entre plus
 * ici : elle est appliquée sur le total panier uniquement. On garde la
 * signature avec `clientDiscount` optionnel pour la rétrocompatibilité mais
 * elle est ignorée.
 */
export function applyDiscount(
  price: number,
  productDiscountPercent?: number | null,
  _clientDiscount?: ClientDiscount | null,
): number {
  if (productDiscountPercent && productDiscountPercent > 0) {
    return Math.max(0, price * (1 - productDiscountPercent / 100));
  }
  return price;
}

/** Stock effectif : pour un PACK, on divise par la taille du pack (nb de paquets vendables). */
export function effectiveStock(v: CartVariant): number {
  if (v.saleType === "PACK" && v.packQuantity && v.packQuantity > 0) {
    return Math.floor(v.stock / v.packQuantity);
  }
  return v.stock;
}

/**
 * Récapitulatif global du panier de la modale.
 * quantities est le nombre d'unités pour UNIT, le nombre de paquets pour PACK.
 * Le total prix compte le contenu réel des paquets (unit × packQuantity × qty).
 */
export function computeCartSummary(
  colors: CartColor[],
  quantities: Record<string, number>,
  productDiscountPercent?: number | null,
  _clientDiscount?: ClientDiscount | null,
): { totalItems: number; totalPacks: number; totalPrice: number } {
  let totalItems = 0;
  let totalPacks = 0;
  let totalPrice = 0;
  for (const c of colors) {
    for (const v of c.variants) {
      const qty = quantities[v.id] ?? 0;
      if (qty <= 0) continue;
      totalItems += qty;
      if (v.saleType === "PACK") totalPacks += qty;
      const unit = applyDiscount(pricePerUnit(v), productDiscountPercent);
      const packQty = v.saleType === "PACK" && v.packQuantity ? v.packQuantity : 1;
      totalPrice += unit * packQty * qty;
    }
  }
  return { totalItems, totalPacks, totalPrice };
}
