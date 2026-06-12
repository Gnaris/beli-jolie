/**
 * Tests du snapshot marketplace utilisé par ProductForm pour décider si la
 * modale "Pousser aux marketplaces" doit s'afficher au save.
 *
 * Invariant testé :
 *  - Modifier UNIQUEMENT un champ local (mots-clés, sous-cat, similaires,
 *    bundle) ne doit PAS changer le snapshot — modale skip.
 *  - Modifier un champ marketplace-pertinent (nom, prix, description, etc.)
 *    DOIT changer le snapshot — modale s'affiche.
 */

import { describe, it, expect } from "vitest";
import {
  buildProductMarketplaceSnapshot,
  LOCAL_ONLY_PRODUCT_FIELDS,
  type ProductMarketplaceSnapshotInput,
} from "@/lib/product-marketplace-snapshot";

/** Minimal valide input — point de départ neutre pour les tests de diff. */
function baseInput(): ProductMarketplaceSnapshotInput {
  return {
    reference: "REF-001",
    name: "Bague test",
    description: "Une description suffisamment longue pour valider la fiche.",
    categoryId: "cat-1",
    variants: [
      {
        colorId: "col-1",
        unitPrice: 12.5,
        weight: 0.3,
        stock: 10,
        saleType: "UNIT",
        packQuantity: null,
        sizeEntries: [{ sizeId: "s1", quantity: 10 }],
        disabled: false,
        pfsColorRefOverride: null,
        packLines: [],
      },
    ],
    colorImages: [
      { groupKey: "col-1", uploadedPaths: ["a.jpg"], orders: [0] },
    ],
    compositions: [{ id: "cmp-1", percentage: 100 }],
    isBestSeller: false,
    discountPercent: null,
    dimLength: null,
    dimWidth: null,
    dimHeight: null,
    dimDiameter: null,
    dimCircumference: null,
    hsCodeId: null,
    productStatus: "OFFLINE",
    manufacturingCountryId: "fr",
    seasonId: "spring",
    sizeDetailsTu: null,
    primaryColorId: "col-1",
  };
}

describe("buildProductMarketplaceSnapshot", () => {
  it("produit la même string pour deux entrées identiques (déterministe)", () => {
    expect(buildProductMarketplaceSnapshot(baseInput())).toBe(
      buildProductMarketplaceSnapshot(baseInput()),
    );
  });

  it("normalise les valeurs absentes (disabled=undefined → false, override=undefined → null)", () => {
    const a = baseInput();
    a.variants[0].disabled = undefined;
    a.variants[0].pfsColorRefOverride = undefined;
    const b = baseInput();
    b.variants[0].disabled = false;
    b.variants[0].pfsColorRefOverride = null;
    expect(buildProductMarketplaceSnapshot(a)).toBe(buildProductMarketplaceSnapshot(b));
  });

  it("CHANGE quand on touche le nom (champ marketplace-pertinent)", () => {
    const a = baseInput();
    const b = baseInput();
    b.name = "Bague rebaptisée";
    expect(buildProductMarketplaceSnapshot(a)).not.toBe(buildProductMarketplaceSnapshot(b));
  });

  it("CHANGE quand on touche le prix unitaire", () => {
    const a = baseInput();
    const b = baseInput();
    b.variants[0].unitPrice = 15.0;
    expect(buildProductMarketplaceSnapshot(a)).not.toBe(buildProductMarketplaceSnapshot(b));
  });

  it("CHANGE quand on touche la description", () => {
    const a = baseInput();
    const b = baseInput();
    b.description = "Nouvelle description plus longue que la limite minimale.";
    expect(buildProductMarketplaceSnapshot(a)).not.toBe(buildProductMarketplaceSnapshot(b));
  });

  it("CHANGE quand on touche la catégorie (impact mapping marketplace)", () => {
    const a = baseInput();
    const b = baseInput();
    b.categoryId = "cat-2";
    expect(buildProductMarketplaceSnapshot(a)).not.toBe(buildProductMarketplaceSnapshot(b));
  });

  it("CHANGE quand on touche les dimensions (envoyées dans la description PFS/AS)", () => {
    const a = baseInput();
    const b = baseInput();
    b.dimLength = 50;
    expect(buildProductMarketplaceSnapshot(a)).not.toBe(buildProductMarketplaceSnapshot(b));
  });

  it("CHANGE quand on touche best-seller (déclenche STAR/UNSTAR sur PFS)", () => {
    const a = baseInput();
    const b = baseInput();
    b.isBestSeller = true;
    expect(buildProductMarketplaceSnapshot(a)).not.toBe(buildProductMarketplaceSnapshot(b));
  });

  it("CHANGE quand on touche le statut du produit (online ↔ offline)", () => {
    const a = baseInput();
    const b = baseInput();
    b.productStatus = "ONLINE";
    expect(buildProductMarketplaceSnapshot(a)).not.toBe(buildProductMarketplaceSnapshot(b));
  });

  it("CHANGE quand on touche le primaryColorId (impact 1re image)", () => {
    const a = baseInput();
    const b = baseInput();
    b.primaryColorId = "col-2";
    expect(buildProductMarketplaceSnapshot(a)).not.toBe(buildProductMarketplaceSnapshot(b));
  });
});

describe("LOCAL_ONLY_PRODUCT_FIELDS", () => {
  // Documentation : ces 4 champs sont EXCLUS du snapshot marketplace pour
  // permettre le skip de la modale demandé par l'utilisatrice. Toute évolution
  // de cette liste doit être consciente (impact UX direct au save).
  it("liste exactement les 4 champs locaux exclus (mots-clés, sous-cat, similaires, bundle)", () => {
    expect([...LOCAL_ONLY_PRODUCT_FIELDS].sort()).toEqual([
      "bundleChildIds",
      "similarProductIds",
      "subCategoryIds",
      "tagNames",
    ]);
  });
});
