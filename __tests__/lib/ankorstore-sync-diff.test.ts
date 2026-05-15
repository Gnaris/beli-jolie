import { describe, it, expect } from "vitest";
import {
  diffAnkorstoreSnapshots,
  diffIsEmpty,
  ANKORSTORE_SNAPSHOT_VERSION,
  type AnkorstoreSyncSnapshot,
} from "@/lib/ankorstore-sync-diff";

const baseSnap: AnkorstoreSyncSnapshot = {
  schemaVersion: ANKORSTORE_SNAPSHOT_VERSION,
  product: {
    externalId: "REF1",
    name: "P",
    description: "D",
    vatRate: 20,
    countryCode: "FR",
    unitMultiplier: 1,
    brandName: "B",
    weightGrams: 50,
    dimensionLengthMm: null,
    dimensionWidthMm: null,
    dimensionHeightMm: null,
    hsCode: null,
  },
  variants: {
    v1: {
      sku: "REF1_R_UNIT_1",
      wholesalePriceCents: 1500,
      retailPriceCents: 3000,
      stockQty: 10,
      isAlwaysInStock: false,
      optionColor: "Rouge",
      optionSize: "M",
      optionMaterial: null,
    },
  },
  images: { Rouge: { "1": "/uploads/produits/ref1/img-1.webp" } },
  status: "active",
};

describe("diffAnkorstoreSnapshots", () => {
  it("snapshot null → tout à envoyer", () => {
    const diff = diffAnkorstoreSnapshots(null, baseSnap);
    expect(diff.productChanged).toBe(true);
    expect(diff.statusChanged).toBe(true);
    expect(diff.variantsChanged).toEqual(["v1"]);
    expect(diff.imagesToUpload).toHaveLength(1);
  });

  it("snapshots identiques → diff vide", () => {
    const diff = diffAnkorstoreSnapshots(baseSnap, baseSnap);
    expect(diffIsEmpty(diff)).toBe(true);
  });

  it("change le stock d'une variante → seule cette variante change", () => {
    const next = {
      ...baseSnap,
      variants: { ...baseSnap.variants, v1: { ...baseSnap.variants.v1, stockQty: 5 } },
    };
    const diff = diffAnkorstoreSnapshots(baseSnap, next);
    expect(diff.variantsChanged).toEqual(["v1"]);
    expect(diff.productChanged).toBe(false);
  });

  it("ajoute une image → upload uniquement le slot ajouté", () => {
    const next: AnkorstoreSyncSnapshot = {
      ...baseSnap,
      images: {
        Rouge: {
          "1": "/uploads/produits/ref1/img-1.webp",
          "2": "/uploads/produits/ref1/img-2.webp",
        },
      },
    };
    const diff = diffAnkorstoreSnapshots(baseSnap, next);
    expect(diff.imagesToUpload).toEqual([
      { colorKey: "Rouge", slot: 2, path: "/uploads/produits/ref1/img-2.webp" },
    ]);
    expect(diff.imagesToDelete).toEqual([]);
  });

  it("remplace une image (même slot, path différent) → upload + pas de delete", () => {
    const next: AnkorstoreSyncSnapshot = {
      ...baseSnap,
      images: { Rouge: { "1": "/uploads/produits/ref1/img-1-v2.webp" } },
    };
    const diff = diffAnkorstoreSnapshots(baseSnap, next);
    expect(diff.imagesToUpload).toHaveLength(1);
    expect(diff.imagesToDelete).toEqual([]);
  });

  it("retire une image → delete uniquement", () => {
    const next: AnkorstoreSyncSnapshot = { ...baseSnap, images: {} };
    const diff = diffAnkorstoreSnapshots(baseSnap, next);
    expect(diff.imagesToUpload).toEqual([]);
    expect(diff.imagesToDelete).toEqual([{ colorKey: "Rouge", slot: 1 }]);
  });

  it("retire une variante → variantsRemoved porte l'ID + SKU, diff non vide", () => {
    const prev: AnkorstoreSyncSnapshot = {
      ...baseSnap,
      variants: {
        v1: baseSnap.variants.v1,
        v2: {
          sku: "REF1_B_UNIT_2",
          wholesalePriceCents: 1500,
          retailPriceCents: 3000,
          stockQty: 4,
          isAlwaysInStock: false,
          optionColor: "Bleu",
          optionSize: "M",
          optionMaterial: null,
        },
      },
    };
    const next: AnkorstoreSyncSnapshot = {
      ...prev,
      variants: { v1: prev.variants.v1 },
    };
    const diff = diffAnkorstoreSnapshots(prev, next);
    expect(diff.variantsRemoved).toEqual([
      { ankorsVariantId: "v2", sku: "REF1_B_UNIT_2" },
    ]);
    expect(diffIsEmpty(diff)).toBe(false);
  });

  it("aucune variante retirée → variantsRemoved vide", () => {
    const diff = diffAnkorstoreSnapshots(baseSnap, baseSnap);
    expect(diff.variantsRemoved).toEqual([]);
  });

  it("change le statut → statusChanged=true", () => {
    const next: AnkorstoreSyncSnapshot = { ...baseSnap, status: "archived" };
    const diff = diffAnkorstoreSnapshots(baseSnap, next);
    expect(diff.statusChanged).toBe(true);
  });

  it("change le poids → productChanged=true", () => {
    const next: AnkorstoreSyncSnapshot = {
      ...baseSnap,
      product: { ...baseSnap.product, weightGrams: 80 },
    };
    const diff = diffAnkorstoreSnapshots(baseSnap, next);
    expect(diff.productChanged).toBe(true);
  });

  it("ajoute une dimension (longueur passe de null à valeur) → productChanged=true", () => {
    const next: AnkorstoreSyncSnapshot = {
      ...baseSnap,
      product: { ...baseSnap.product, dimensionLengthMm: 150 },
    };
    const diff = diffAnkorstoreSnapshots(baseSnap, next);
    expect(diff.productChanged).toBe(true);
  });

  it("modifie une dimension existante → productChanged=true", () => {
    const prev: AnkorstoreSyncSnapshot = {
      ...baseSnap,
      product: {
        ...baseSnap.product,
        dimensionLengthMm: 150,
        dimensionWidthMm: 80,
        dimensionHeightMm: 30,
      },
    };
    const next: AnkorstoreSyncSnapshot = {
      ...prev,
      product: { ...prev.product, dimensionHeightMm: 40 },
    };
    const diff = diffAnkorstoreSnapshots(prev, next);
    expect(diff.productChanged).toBe(true);
  });

  it("dimensions identiques (avec valeurs) → diff vide", () => {
    const prev: AnkorstoreSyncSnapshot = {
      ...baseSnap,
      product: {
        ...baseSnap.product,
        dimensionLengthMm: 150,
        dimensionWidthMm: 80,
        dimensionHeightMm: 30,
      },
    };
    const next: AnkorstoreSyncSnapshot = { ...prev };
    const diff = diffAnkorstoreSnapshots(prev, next);
    expect(diff.productChanged).toBe(false);
  });

  it("renseigner un code SH (passe de null à valeur) → productChanged=true", () => {
    const next: AnkorstoreSyncSnapshot = {
      ...baseSnap,
      product: { ...baseSnap.product, hsCode: "7117190000" },
    };
    const diff = diffAnkorstoreSnapshots(baseSnap, next);
    expect(diff.productChanged).toBe(true);
  });

  it("changer le code SH → productChanged=true", () => {
    const prev: AnkorstoreSyncSnapshot = {
      ...baseSnap,
      product: { ...baseSnap.product, hsCode: "7117190000" },
    };
    const next: AnkorstoreSyncSnapshot = {
      ...prev,
      product: { ...prev.product, hsCode: "7113190000" },
    };
    const diff = diffAnkorstoreSnapshots(prev, next);
    expect(diff.productChanged).toBe(true);
  });

  it("ajouter une composition (optionMaterial passe de null à valeur) → variante marquee changee", () => {
    const next: AnkorstoreSyncSnapshot = {
      ...baseSnap,
      variants: {
        v1: { ...baseSnap.variants.v1, optionMaterial: "50% Acier inoxydable, 50% Laiton" },
      },
    };
    const diff = diffAnkorstoreSnapshots(baseSnap, next);
    expect(diff.variantsChanged).toEqual(["v1"]);
    expect(diff.productChanged).toBe(false);
  });

  it("changer la composition → variante marquee changee", () => {
    const prev: AnkorstoreSyncSnapshot = {
      ...baseSnap,
      variants: { v1: { ...baseSnap.variants.v1, optionMaterial: "100% Coton" } },
    };
    const next: AnkorstoreSyncSnapshot = {
      ...prev,
      variants: { v1: { ...prev.variants.v1, optionMaterial: "100% Lin" } },
    };
    const diff = diffAnkorstoreSnapshots(prev, next);
    expect(diff.variantsChanged).toEqual(["v1"]);
  });

  it("composition identique → diff vide", () => {
    const prev: AnkorstoreSyncSnapshot = {
      ...baseSnap,
      variants: { v1: { ...baseSnap.variants.v1, optionMaterial: "100% Argent" } },
    };
    const next: AnkorstoreSyncSnapshot = { ...prev };
    const diff = diffAnkorstoreSnapshots(prev, next);
    expect(diffIsEmpty(diff)).toBe(true);
  });
});
