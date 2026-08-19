import { describe, it, expect } from "vitest";
import {
  ORDERCHAMP_SNAPSHOT_VERSION,
  diffSnapshots,
  diffIsEmpty,
  productMetaEqual,
  type OrderchampSyncSnapshot,
  type OrderchampVariantSnapshot,
} from "@/lib/orderchamp-sync-diff";

function makeVariant(sku: string, overrides: Partial<OrderchampVariantSnapshot> = {}): OrderchampVariantSnapshot {
  return {
    sku,
    wholesalePriceCents: 450,
    retailPriceCents: 1350,
    availableQuantity: 10,
    active: true,
    colorOption: "Or",
    sizeOption: "TU",
    images: [],
    weightGrams: 25,
    lengthCm: 6.5,
    widthCm: 6.5,
    heightCm: 0.3,
    orderchampVariantId: null,
    ...overrides,
  };
}

function makeSnapshot(overrides: Partial<OrderchampSyncSnapshot> = {}): OrderchampSyncSnapshot {
  return {
    schemaVersion: ORDERCHAMP_SNAPSHOT_VERSION,
    product: {
      title: "TEST",
      description: "desc",
      categoryId: "cat1",
      vendor: "Beli & Jolie",
      countryAlpha2: "CN",
      productType: "",
      tags: [],
      images: [],
    },
    variants: { "sku-1": makeVariant("sku-1") },
    lifecycleState: "PUBLISHED",
    ...overrides,
  };
}

describe("orderchamp-sync-diff", () => {
  it("diff avec snapshot null = tout à envoyer", () => {
    const next = makeSnapshot();
    const diff = diffSnapshots(null, next);
    expect(diff.productChanged).toBe(true);
    expect(diff.lifecycleChanged).toBe(true);
    expect(diff.variantsAdded).toEqual(["sku-1"]);
    expect(diff.variantsChanged).toEqual(["sku-1"]);
    expect(diff.productImagesChanged).toBe(false); // sans forceImages
  });

  it("forceImages=true inclut aussi les images", () => {
    const next = makeSnapshot();
    const diff = diffSnapshots(null, next, { forceImages: true });
    expect(diff.productImagesChanged).toBe(true);
    expect(diff.variantsImagesChanged).toEqual(["sku-1"]);
  });

  it("diff vide quand tout est identique", () => {
    const prev = makeSnapshot();
    const next = makeSnapshot();
    const diff = diffSnapshots(prev, next);
    expect(diffIsEmpty(diff)).toBe(true);
  });

  it("détecte un changement de prix uniquement", () => {
    const prev = makeSnapshot();
    const next = makeSnapshot({
      variants: { "sku-1": makeVariant("sku-1", { wholesalePriceCents: 500 }) },
    });
    const diff = diffSnapshots(prev, next);
    expect(diff.pricesOnlyChanged).toEqual(["sku-1"]);
    expect(diff.inventoryOnlyChanged).toEqual([]);
    expect(diff.variantsChanged).toEqual([]);
  });

  it("détecte un changement de stock uniquement", () => {
    const prev = makeSnapshot();
    const next = makeSnapshot({
      variants: { "sku-1": makeVariant("sku-1", { availableQuantity: 5 }) },
    });
    const diff = diffSnapshots(prev, next);
    expect(diff.inventoryOnlyChanged).toEqual(["sku-1"]);
  });

  it("détecte l'ajout et le retrait de variantes", () => {
    const prev = makeSnapshot({ variants: { "sku-1": makeVariant("sku-1") } });
    const next = makeSnapshot({
      variants: {
        "sku-1": makeVariant("sku-1"),
        "sku-2": makeVariant("sku-2", { colorOption: "Argenté" }),
      },
    });
    const diff = diffSnapshots(prev, next);
    expect(diff.variantsAdded).toEqual(["sku-2"]);
    expect(diff.variantsRemoved).toEqual([]);

    const back = diffSnapshots(next, prev);
    expect(back.variantsRemoved).toEqual(["sku-2"]);
  });

  it("productMetaEqual = vrai si tous les champs meta sont pareils", () => {
    const s1 = makeSnapshot();
    const s2 = makeSnapshot();
    expect(productMetaEqual(s1.product, s2.product)).toBe(true);
  });

  it("productMetaEqual = faux si categorie change", () => {
    const s1 = makeSnapshot();
    const s2 = makeSnapshot({ product: { ...s1.product, categoryId: "cat2" } });
    expect(productMetaEqual(s1.product, s2.product)).toBe(false);
  });

  it("snapshot avec ancienne version = tout à repush", () => {
    const prev = makeSnapshot({ schemaVersion: 0 as never });
    const next = makeSnapshot();
    const diff = diffSnapshots(prev, next);
    expect(diff.productChanged).toBe(true);
    expect(diff.variantsAdded).toEqual(["sku-1"]);
  });
});
