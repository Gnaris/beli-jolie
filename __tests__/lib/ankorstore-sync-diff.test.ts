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

  it("change le statut → statusChanged=true", () => {
    const next: AnkorstoreSyncSnapshot = { ...baseSnap, status: "archived" };
    const diff = diffAnkorstoreSnapshots(baseSnap, next);
    expect(diff.statusChanged).toBe(true);
  });
});
