/**
 * Helpers d'affichage pour les articles de commande.
 * Un OrderItem PACK stocke `quantity` = nombre de paquets, `packQty` = pièces par paquet.
 * Côté UI on veut afficher le nombre total de pièces livrées (`packQty × quantity`).
 */

export interface OrderItemLike {
  saleType: string;
  quantity: number;
  packQty: number | null;
}

/** Nombre de pièces réellement livrées pour cet article. */
export function getTotalUnits(item: OrderItemLike): number {
  if (item.saleType === "PACK") {
    return item.quantity * (item.packQty ?? 1);
  }
  return item.quantity;
}

/**
 * Libellé court de la quantité :
 * - UNIT · 5 → "5"
 * - PACK ×6 · 3 → "18 (3 paquets ×6)"
 */
export function formatQuantityLabel(item: OrderItemLike): string {
  if (item.saleType === "PACK" && item.packQty) {
    const total = item.packQty * item.quantity;
    return `${total} (${item.quantity} paquet${item.quantity > 1 ? "s" : ""} ×${item.packQty})`;
  }
  return String(item.quantity);
}
