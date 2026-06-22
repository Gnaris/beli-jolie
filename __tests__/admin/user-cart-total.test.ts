import { describe, it, expect } from "vitest";

// Réplique le calcul du `cartTotal` affiché sur /admin/utilisateurs/[id]
// (cf. app/(admin)/admin/utilisateurs/[id]/page.tsx).
// Rappel : `unitPrice` en BDD est le prix TOTAL aussi bien pour UNIT que pour
// PACK (cf. ProductForm.tsx → `unitPrice: computeTotalPrice(v)` pour les PACK).
// Avant correction, ce calcul multipliait à nouveau par `packQuantity` pour les
// PACK, ce qui faisait apparaître un panier à ~10× le bon montant côté admin.
type CartItem = {
  quantity: number;
  variant: {
    unitPrice: number;
    saleType: "UNIT" | "PACK";
    packQuantity: number | null;
  };
};

function computeAdminCartTotal(items: CartItem[]): number {
  return items.reduce((sum, item) => {
    return sum + Number(item.variant.unitPrice) * item.quantity;
  }, 0);
}

describe("/admin/utilisateurs/[id] — total du panier", () => {
  it("PACK : utilise le prix total du pack tel quel (pas × packQuantity)", () => {
    const items: CartItem[] = [
      { quantity: 1, variant: { unitPrice: 39.6, saleType: "PACK", packQuantity: 12 } },
    ];
    expect(computeAdminCartTotal(items)).toBeCloseTo(39.6, 2);
    expect(computeAdminCartTotal(items)).not.toBeCloseTo(475.2, 2);
  });

  it("UNIT : prix × quantité", () => {
    const items: CartItem[] = [
      { quantity: 4, variant: { unitPrice: 2.8, saleType: "UNIT", packQuantity: null } },
    ];
    expect(computeAdminCartTotal(items)).toBeCloseTo(11.2, 2);
  });

  it("Cas réel client Alison THIBAULT : 3 UNIT + 2 PACK = 99.40€ (et non 878.20€)", () => {
    const items: CartItem[] = [
      { quantity: 4, variant: { unitPrice: 2.8,  saleType: "UNIT", packQuantity: null } }, // A298
      { quantity: 3, variant: { unitPrice: 3.0,  saleType: "UNIT", packQuantity: null } }, // A207
      { quantity: 3, variant: { unitPrice: 2.8,  saleType: "UNIT", packQuantity: null } }, // A2425
      { quantity: 1, variant: { unitPrice: 39.6, saleType: "PACK", packQuantity: 12 } },   // A2472
      { quantity: 1, variant: { unitPrice: 31.2, saleType: "PACK", packQuantity: 12 } },   // A1852DO
    ];
    expect(computeAdminCartTotal(items)).toBeCloseTo(99.4, 2);
    expect(computeAdminCartTotal(items)).not.toBeCloseTo(878.2, 2);
  });
});
