import { describe, it, expect } from "vitest";
import { computeVariantPackTotalQty } from "@/components/admin/products/AdminProductsTable";

// La BDD stocke `unitPrice` = prix TOTAL du paquet pour un PACK.
// Pour afficher le prix par pièce dans le tiroir variantes, on divise par la
// somme des quantités des tailles (fallback packQuantity, puis 1 pour éviter
// une division par zéro).
describe("computeVariantPackTotalQty", () => {
  it("retourne 1 pour une variante UNIT (quelles que soient les tailles)", () => {
    expect(
      computeVariantPackTotalQty({
        saleType: "UNIT",
        packQuantity: null,
        variantSizes: [{ quantity: 3 }, { quantity: 2 }],
      }),
    ).toBe(1);
  });

  it("PACK : somme des quantités des tailles quand elles sont renseignées", () => {
    expect(
      computeVariantPackTotalQty({
        saleType: "PACK",
        packQuantity: 12,
        variantSizes: [{ quantity: 4 }, { quantity: 6 }],
      }),
    ).toBe(10);
  });

  it("PACK : fallback sur packQuantity si aucune taille avec quantité", () => {
    expect(
      computeVariantPackTotalQty({
        saleType: "PACK",
        packQuantity: 12,
        variantSizes: [],
      }),
    ).toBe(12);
  });

  it("PACK : fallback sur override quand il est fourni (édition en cours)", () => {
    expect(
      computeVariantPackTotalQty(
        { saleType: "PACK", packQuantity: 12, variantSizes: [] },
        20,
      ),
    ).toBe(20);
  });

  it("PACK : retourne 1 si tout est à 0 (évite division par zéro)", () => {
    expect(
      computeVariantPackTotalQty({
        saleType: "PACK",
        packQuantity: 0,
        variantSizes: [],
      }),
    ).toBe(1);
  });

  it("PACK : priorité aux tailles sur packQuantity quand les deux sont présents", () => {
    expect(
      computeVariantPackTotalQty({
        saleType: "PACK",
        packQuantity: 12,
        variantSizes: [{ quantity: 5 }],
      }),
    ).toBe(5);
  });
});

// Vérifie l'invariant qui rend l'affichage cohérent : prix unitaire ×
// packTotalQty ≈ prix total stocké en BDD (aux arrondis 0,01 € près).
describe("prix unitaire ↔ total round-trip", () => {
  it("un total de 60€ sur un pack de 10 pièces donne 6€ unitaire", () => {
    const total = 60;
    const qty = computeVariantPackTotalQty({
      saleType: "PACK",
      packQuantity: 10,
      variantSizes: [{ quantity: 10 }],
    });
    const unit = Math.round((total / qty) * 100) / 100;
    expect(unit).toBe(6);
    // Retour au total après édition (identité) :
    expect(Math.round(unit * qty * 100) / 100).toBe(total);
  });
});
