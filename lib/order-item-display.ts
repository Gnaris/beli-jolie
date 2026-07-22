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

/**
 * Filtre les articles par requête libre (référence, nom ou couleur).
 * Casse ignorée, requête vidée = liste inchangée.
 */
export interface OrderItemSearchable {
  productRef: string;
  productName: string;
  colorName: string;
}

export function filterOrderItemsByQuery<T extends OrderItemSearchable>(items: T[], query: string): T[] {
  const q = query.trim().toLowerCase();
  if (!q) return items;
  return items.filter(
    (it) =>
      it.productRef.toLowerCase().includes(q) ||
      it.productName.toLowerCase().includes(q) ||
      it.colorName.toLowerCase().includes(q),
  );
}

export type OrderSummarySort = "none" | "ref_asc" | "ref_desc" | "qty_asc" | "qty_desc";

export interface OrderSummaryFilters {
  category: string;
  sort: OrderSummarySort;
}

export interface OrderItemForSummary extends OrderItemLike, OrderItemSearchable {}

/**
 * Applique filtre catégorie + tri au résumé de la commande.
 * - `category` = "" → toutes les catégories.
 * - `sort` = "none" → ordre d'origine préservé (stable).
 * `categoryByRef` mappe productRef → nom de catégorie.
 */
export function applyOrderSummaryFilters<T extends OrderItemForSummary>(
  items: T[],
  filters: OrderSummaryFilters,
  categoryByRef: Record<string, string>,
): T[] {
  const filtered = filters.category
    ? items.filter((it) => (categoryByRef[it.productRef] ?? "") === filters.category)
    : items;

  if (filters.sort === "none") return filtered;

  const arr = [...filtered];
  switch (filters.sort) {
    case "ref_asc":
      arr.sort((a, b) => a.productRef.localeCompare(b.productRef, "fr", { numeric: true }));
      break;
    case "ref_desc":
      arr.sort((a, b) => b.productRef.localeCompare(a.productRef, "fr", { numeric: true }));
      break;
    case "qty_asc":
      arr.sort((a, b) => getTotalUnits(a) - getTotalUnits(b));
      break;
    case "qty_desc":
      arr.sort((a, b) => getTotalUnits(b) - getTotalUnits(a));
      break;
  }
  return arr;
}

/**
 * Liste triée alphabétiquement des catégories présentes dans les articles.
 * Ignore les refs sans catégorie connue.
 */
export function listOrderSummaryCategories<T extends OrderItemSearchable>(
  items: T[],
  categoryByRef: Record<string, string>,
): string[] {
  const set = new Set<string>();
  for (const it of items) {
    const cat = categoryByRef[it.productRef];
    if (cat) set.add(cat);
  }
  return [...set].sort((a, b) => a.localeCompare(b, "fr"));
}
