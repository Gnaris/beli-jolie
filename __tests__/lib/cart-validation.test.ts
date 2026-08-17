/**
 * Tests du helper `validateCartLines` utilisé partout où on vérifie qu'un
 * panier est vendable maintenant (produit ONLINE + stock suffisant).
 *
 * Cible : /api/cart/validate qui gate les transitions /panier → /panier/commande,
 * mount de checkout, et bascule d'étape wizard.
 */
import { describe, it, expect } from "vitest";
import { validateCartLines } from "@/lib/cart-validation";

function unitLine(overrides: {
  id?: string;
  quantity?: number;
  stock?: number;
  status?: "ONLINE" | "OFFLINE" | "ARCHIVED" | "SYNCING";
  name?: string;
}) {
  return {
    id: overrides.id ?? "ci-1",
    quantity: overrides.quantity ?? 1,
    variant: {
      id: "var-1",
      saleType: "UNIT" as const,
      packQuantity: null,
      stock: overrides.stock ?? 10,
      product: {
        name: overrides.name ?? "Bague test",
        reference: "REF-1",
        status: overrides.status ?? ("ONLINE" as const),
      },
    },
  };
}

function packLine(overrides: {
  id?: string;
  quantity?: number;
  stock?: number;
  packQuantity?: number;
  status?: "ONLINE" | "OFFLINE" | "ARCHIVED" | "SYNCING";
  name?: string;
}) {
  return {
    id: overrides.id ?? "ci-pack-1",
    quantity: overrides.quantity ?? 1,
    variant: {
      id: "var-pack-1",
      saleType: "PACK" as const,
      packQuantity: overrides.packQuantity ?? 12,
      stock: overrides.stock ?? 24,
      product: {
        name: overrides.name ?? "Pack boucles",
        reference: "PACK-1",
        status: overrides.status ?? ("ONLINE" as const),
      },
    },
  };
}

describe("validateCartLines", () => {
  it("panier vide → ok:true", () => {
    const res = validateCartLines([]);
    expect(res.ok).toBe(true);
    expect(res.errors).toEqual([]);
  });

  it("un article ONLINE avec assez de stock passe", () => {
    const res = validateCartLines([unitLine({ stock: 5, quantity: 2 })]);
    expect(res.ok).toBe(true);
  });

  it("détecte un article OFFLINE et propose un message clair", () => {
    const res = validateCartLines([
      unitLine({ status: "OFFLINE", name: "Bague retirée" }),
    ]);
    expect(res.ok).toBe(false);
    expect(res.errors).toHaveLength(1);
    expect(res.errors[0].reason).toBe("offline");
    expect(res.errors[0].message).toMatch(/Bague retirée/);
    expect(res.errors[0].message).toMatch(/plus disponible/i);
  });

  it("détecte ARCHIVED et SYNCING au même titre qu'OFFLINE", () => {
    const res = validateCartLines([
      unitLine({ id: "a", status: "ARCHIVED", name: "Archived" }),
      unitLine({ id: "b", status: "SYNCING", name: "Syncing" }),
    ]);
    expect(res.ok).toBe(false);
    expect(res.errors).toHaveLength(2);
    expect(res.errors.every((e) => e.reason === "offline")).toBe(true);
  });

  it("détecte une rupture de stock (stock = 0)", () => {
    const res = validateCartLines([
      unitLine({ stock: 0, quantity: 1, name: "Collier" }),
    ]);
    expect(res.ok).toBe(false);
    expect(res.errors[0].reason).toBe("out_of_stock");
    expect(res.errors[0].message).toMatch(/rupture/i);
  });

  it("détecte un stock insuffisant et affiche reste vs demandé", () => {
    const res = validateCartLines([
      unitLine({ stock: 2, quantity: 5, name: "Bracelet" }),
    ]);
    expect(res.ok).toBe(false);
    expect(res.errors[0].reason).toBe("insufficient_stock");
    expect(res.errors[0].available).toBe(2);
    expect(res.errors[0].requested).toBe(5);
    expect(res.errors[0].message).toMatch(/il en reste 2/);
    expect(res.errors[0].message).toMatch(/vous en demandez 5/);
  });

  it("PACK : rupture exprimée en paquets (pas en pièces)", () => {
    // stock 8 pièces, 12 pièces/paquet → 0 paquets dispo, on demande 1 paquet
    const res = validateCartLines([
      packLine({ packQuantity: 12, stock: 8, quantity: 1 }),
    ]);
    expect(res.ok).toBe(false);
    expect(res.errors[0].reason).toBe("out_of_stock");
    expect(res.errors[0].message).toMatch(/rupture/i);
  });

  it("PACK : stock insuffisant exprimé en paquets", () => {
    // stock 30 pièces, 12 pièces/paquet → 2 paquets dispo, on demande 3
    const res = validateCartLines([
      packLine({ packQuantity: 12, stock: 30, quantity: 3 }),
    ]);
    expect(res.ok).toBe(false);
    expect(res.errors[0].reason).toBe("insufficient_stock");
    expect(res.errors[0].available).toBe(2);
    expect(res.errors[0].unitLabel).toBe("paquets");
    expect(res.errors[0].message).toMatch(/il en reste 2 paquets/);
    expect(res.errors[0].message).toMatch(/vous en demandez 3/);
  });

  it("PACK : 1 paquet dispo → unitLabel singulier", () => {
    // stock 20 pièces, 12/paquet → 1 paquet dispo, on demande 2
    const res = validateCartLines([
      packLine({ packQuantity: 12, stock: 20, quantity: 2 }),
    ]);
    expect(res.errors[0].unitLabel).toBe("paquet");
    expect(res.errors[0].message).toMatch(/il en reste 1 paquet/);
  });

  it("agrège plusieurs erreurs dans le même appel", () => {
    const res = validateCartLines([
      unitLine({ id: "ok", stock: 5, quantity: 1 }),
      unitLine({ id: "offline", status: "ARCHIVED", name: "Retirée" }),
      unitLine({ id: "rupture", stock: 0, quantity: 1, name: "Cassé" }),
    ]);
    expect(res.ok).toBe(false);
    expect(res.errors).toHaveLength(2);
    const reasons = res.errors.map((e) => e.reason).sort();
    expect(reasons).toEqual(["offline", "out_of_stock"]);
  });
});
