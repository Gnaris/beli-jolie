/**
 * Conversion quantité commandée → unités physiques de stock.
 *
 * Extrait de `lib/stock.ts` parce que ce dernier est un module `"use server"`
 * qui ne peut exporter que des fonctions async. Importé par stock.ts et par
 * les server actions qui touchent au stock (placeOrder, etc.) ainsi que par
 * les tests Vitest.
 */

/**
 * Combien d'unités physiques retirer/remettre au stock pour une ligne de
 * commande. PACK : quantité commandée × packQuantity. UNIT : quantité directe.
 *
 * Lit `saleType` + `packQuantity` dans `variantSnapshot` (figé à la
 * création de la commande) — survit donc à une suppression de variante
 * côté admin.
 */
export function stockUnitsForOrderItem(item: {
  quantity: number;
  variantSnapshot: string | null;
}): number {
  if (!item.variantSnapshot) return item.quantity;
  try {
    const snap = JSON.parse(item.variantSnapshot);
    if (
      snap.saleType === "PACK" &&
      typeof snap.packQuantity === "number" &&
      snap.packQuantity > 0
    ) {
      return item.quantity * snap.packQuantity;
    }
  } catch {
    // Snapshot illisible : on retombe sur le comportement UNIT (safe).
  }
  return item.quantity;
}

/**
 * Variante côté panier : on a directement saleType + packQuantity sur le
 * variant inclus. Sert à `placeOrder` pour décrémenter le stock dans la
 * transaction Prisma.
 */
export function stockUnitsForCartLine(line: {
  quantity: number;
  variant: { saleType: "UNIT" | "PACK"; packQuantity: number | null };
}): number {
  if (
    line.variant.saleType === "PACK" &&
    line.variant.packQuantity &&
    line.variant.packQuantity > 0
  ) {
    return line.quantity * line.variant.packQuantity;
  }
  return line.quantity;
}
