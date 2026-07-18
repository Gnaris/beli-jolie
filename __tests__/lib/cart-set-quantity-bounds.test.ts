import { describe, it, expect } from "vitest";

// Réplique la logique de bornage de setCartItemQuantity (app/actions/client/cart.ts)
// afin de tester le comportement sans DB.

interface Variant {
  stock: number;
  saleType: "UNIT" | "PACK";
  packQuantity: number | null;
  productStatus: "ONLINE" | "OFFLINE" | "ARCHIVED" | "SYNCING";
}

type Result =
  | { success: true; quantity: number; capped: boolean }
  | { success: false; error: string };

function computeCappedQuantity(variant: Variant, requestedQty: number): Result {
  if (!Number.isFinite(requestedQty) || requestedQty < 0) {
    return { success: false, error: "Quantité invalide." };
  }
  if (requestedQty === 0) {
    return { success: true, quantity: 0, capped: false };
  }
  if (variant.productStatus !== "ONLINE") {
    return { success: false, error: "Ce produit n'est plus disponible à la vente." };
  }
  const effectiveStock = variant.saleType === "PACK" && variant.packQuantity
    ? Math.floor(variant.stock / variant.packQuantity)
    : variant.stock;
  if (effectiveStock <= 0) {
    return { success: false, error: "Stock épuisé." };
  }
  const cappedQty = Math.min(Math.floor(requestedQty), effectiveStock);
  return { success: true, quantity: cappedQty, capped: cappedQty < requestedQty };
}

describe("setCartItemQuantity — bornage & validation", () => {
  const validUnit: Variant = { stock: 20, saleType: "UNIT", packQuantity: null, productStatus: "ONLINE" };
  const validPack6: Variant = { stock: 20, saleType: "PACK", packQuantity: 6, productStatus: "ONLINE" };

  it("qty négative → erreur", () => {
    const r = computeCappedQuantity(validUnit, -1);
    expect(r.success).toBe(false);
  });

  it("qty = 0 → succès qty 0 (déclenche suppression côté action)", () => {
    const r = computeCappedQuantity(validUnit, 0);
    expect(r).toEqual({ success: true, quantity: 0, capped: false });
  });

  it("qty inférieure au stock → passe telle quelle", () => {
    const r = computeCappedQuantity(validUnit, 5);
    expect(r).toEqual({ success: true, quantity: 5, capped: false });
  });

  it("qty supérieure au stock UNIT → bornée + flag capped", () => {
    const r = computeCappedQuantity(validUnit, 50);
    expect(r).toEqual({ success: true, quantity: 20, capped: true });
  });

  it("PACK ×6 sur 20 unités stock → max 3 packs (20 / 6 = 3.33 → 3)", () => {
    const r = computeCappedQuantity(validPack6, 5);
    expect(r).toEqual({ success: true, quantity: 3, capped: true });
  });

  it("PACK ×6 sur 20 unités stock, demande 2 packs → OK", () => {
    const r = computeCappedQuantity(validPack6, 2);
    expect(r).toEqual({ success: true, quantity: 2, capped: false });
  });

  it("Produit OFFLINE → erreur (interdit d'ajouter au panier)", () => {
    const r = computeCappedQuantity({ ...validUnit, productStatus: "OFFLINE" }, 1);
    expect(r.success).toBe(false);
  });

  it("Produit ARCHIVED → erreur", () => {
    const r = computeCappedQuantity({ ...validUnit, productStatus: "ARCHIVED" }, 1);
    expect(r.success).toBe(false);
  });

  it("Stock 0 → erreur épuisé (interdit d'ajouter à qty > 0)", () => {
    const r = computeCappedQuantity({ ...validUnit, stock: 0 }, 1);
    expect(r.success).toBe(false);
  });

  it("Stock 0 avec qty 0 → succès (suppression toujours possible)", () => {
    const r = computeCappedQuantity({ ...validUnit, stock: 0 }, 0);
    expect(r).toEqual({ success: true, quantity: 0, capped: false });
  });

  it("qty décimale → tronquée à l'entier", () => {
    const r = computeCappedQuantity(validUnit, 3.7);
    expect(r).toEqual({ success: true, quantity: 3, capped: true });
  });

  it("PACK sans packQuantity défini → fallback stock unité", () => {
    const r = computeCappedQuantity({ ...validPack6, packQuantity: null }, 15);
    expect(r).toEqual({ success: true, quantity: 15, capped: false });
  });
});
