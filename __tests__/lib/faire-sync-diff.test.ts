import { describe, it, expect } from "vitest";
import {
  diffSnapshots,
  diffIsEmpty,
  FAIRE_SNAPSHOT_VERSION,
  type FaireSyncSnapshot,
} from "@/lib/faire-sync-diff";

function snap(overrides: Partial<FaireSyncSnapshot> = {}): FaireSyncSnapshot {
  return {
    schemaVersion: FAIRE_SNAPSHOT_VERSION,
    product: {
      name: "Bracelet test",
      shortDescription: "court",
      description: "long",
      taxonomyTypeId: "tt_czw8pmzjrc",
      countryAlpha2: "CN",
      minimumOrderQuantity: 1,
      perStyleMinimumOrderQuantity: 1,
      images: ["/root-a.jpg"],
    },
    variants: {
      sku1: {
        sku: "sku1",
        wholesalePriceCents: 750,
        retailPriceCents: 1500,
        availableQuantity: 10,
        active: true,
        colorOption: "Or",
        images: ["/u/a.jpg"],
        weightGrams: 30,
        lengthCm: null,
        widthCm: null,
        heightCm: null,
        tariffCode: "7117.19.00",
      },
    },
    lifecycleState: "PUBLISHED",
    ...overrides,
  };
}

describe("diffSnapshots", () => {
  it("traite null prev comme tout-à-envoyer SAUF les images (évite '2 images principales')", () => {
    const d = diffSnapshots(null, snap());
    expect(d.productChanged).toBe(true);
    expect(d.lifecycleChanged).toBe(true);
    expect(d.variantsAdded).toEqual(["sku1"]);
    // Images NE doivent PAS être re-poussées sur snapshot null : Faire
    // déduplique par contenu et refuse les re-uploads de mêmes URLs.
    expect(d.productImagesChanged).toBe(false);
    expect(d.variantsImagesChanged).toEqual([]);
    expect(diffIsEmpty(d)).toBe(false);
  });

  it("diff vide quand rien n'a changé", () => {
    const a = snap();
    const b = snap();
    const d = diffSnapshots(a, b);
    expect(diffIsEmpty(d)).toBe(true);
  });

  it("détecte un changement de nom comme productChanged mais PAS productImagesChanged", () => {
    const a = snap();
    const b = snap({ product: { ...a.product, name: "Nouveau nom" } });
    const d = diffSnapshots(a, b);
    expect(d.productChanged).toBe(true);
    expect(d.productImagesChanged).toBe(false);
    expect(d.variantsChanged).toHaveLength(0);
  });

  it("détecte un changement d'images racine comme productImagesChanged", () => {
    const a = snap();
    const b = snap({ product: { ...a.product, images: ["/root-b.jpg"] } });
    const d = diffSnapshots(a, b);
    expect(d.productChanged).toBe(true);
    expect(d.productImagesChanged).toBe(true);
  });

  it("détecte un changement d'images variante comme variantsImagesChanged + variantsChanged", () => {
    const a = snap();
    const b = snap({
      variants: {
        sku1: { ...a.variants.sku1, images: ["/u/b.jpg"] },
      },
    });
    const d = diffSnapshots(a, b);
    expect(d.variantsImagesChanged).toEqual(["sku1"]);
    expect(d.variantsChanged).toEqual(["sku1"]);
  });

  it("inventoryOnlyChanged quand seul le stock bouge", () => {
    const a = snap();
    const b = snap({
      variants: {
        sku1: { ...a.variants.sku1, availableQuantity: 20 },
      },
    });
    const d = diffSnapshots(a, b);
    expect(d.inventoryOnlyChanged).toEqual(["sku1"]);
    expect(d.pricesOnlyChanged).toEqual([]);
    expect(d.variantsChanged).toEqual([]);
  });

  it("pricesOnlyChanged quand seul un prix bouge", () => {
    const a = snap();
    const b = snap({
      variants: {
        sku1: { ...a.variants.sku1, wholesalePriceCents: 800 },
      },
    });
    const d = diffSnapshots(a, b);
    expect(d.pricesOnlyChanged).toEqual(["sku1"]);
    expect(d.inventoryOnlyChanged).toEqual([]);
  });

  it("variantsChanged quand prix ET stock bougent ensemble (pas dans les listes 'only')", () => {
    const a = snap();
    const b = snap({
      variants: {
        sku1: { ...a.variants.sku1, availableQuantity: 5, wholesalePriceCents: 900 },
      },
    });
    const d = diffSnapshots(a, b);
    expect(d.variantsChanged).toEqual(["sku1"]);
    expect(d.pricesOnlyChanged).toEqual([]);
    expect(d.inventoryOnlyChanged).toEqual([]);
  });

  it("détecte les variantes ajoutées et supprimées", () => {
    const a = snap();
    const b = snap({
      variants: {
        sku2: {
          sku: "sku2",
          wholesalePriceCents: 750,
          retailPriceCents: 1500,
          availableQuantity: 5,
          active: true,
          colorOption: "Argent",
          images: [],
          weightGrams: 30,
          lengthCm: null,
          widthCm: null,
          heightCm: null,
          tariffCode: null,
        },
      },
    });
    const d = diffSnapshots(a, b);
    expect(d.variantsAdded).toEqual(["sku2"]);
    expect(d.variantsRemoved).toEqual(["sku1"]);
  });

  it("traite un schemaVersion différent comme reset complet", () => {
    const a = snap({ schemaVersion: 0 as unknown as 2 });
    const b = snap();
    const d = diffSnapshots(a, b);
    expect(d.productChanged).toBe(true);
    expect(d.variantsAdded).toEqual(["sku1"]);
  });
});
