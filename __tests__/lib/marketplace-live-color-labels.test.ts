import { describe, it, expect } from "vitest";
import { extractLiveMarketplaceColorLabels } from "@/lib/marketplace-live-color-labels";

describe("extractLiveMarketplaceColorLabels", () => {
  const pfsColorOptions = [
    { ref: "BRUN", label: "Brun" },
    { ref: "CHOCO", label: "Chocolat" },
    { ref: "MARINE" }, // pas de label FR → on affiche la ref brute
  ];

  it("PFS : mappe l'ID variante vers le libellé (label + ref)", () => {
    const snapshot = {
      variants: {
        pfs_v1: { colorRef: "BRUN", price: 10, stock: 3, weight: 0.2, isActive: true },
        pfs_v2: { colorRef: "MARINE", price: 10, stock: 3, weight: 0.2, isActive: true },
        pfs_v3: { price: 10, stock: 3, weight: 0.2, isActive: true }, // pas de colorRef
      },
    };
    const out = extractLiveMarketplaceColorLabels({
      pfsSnapshot: snapshot,
      ankorsSnapshot: null,
      faireSnapshot: null,
      pfsColorOptions,
    });
    expect(out.pfs).toEqual({
      pfs_v1: "Brun (BRUN)",
      pfs_v2: "MARINE",
    });
    expect(out.pfs.pfs_v3).toBeUndefined();
  });

  it("Ankor : mappe l'ID variante vers optionColor du snapshot", () => {
    const snapshot = {
      variants: {
        ank_1: { optionColor: "Brun clair", sku: "x", wholesalePriceCents: 100, retailPriceCents: 200, stockQty: 1, isAlwaysInStock: false, optionSize: "TU" },
        ank_2: { optionColor: "  ", sku: "x" },
        ank_3: { sku: "x" },
      },
    };
    const out = extractLiveMarketplaceColorLabels({
      pfsSnapshot: null,
      ankorsSnapshot: snapshot,
      faireSnapshot: null,
      pfsColorOptions: [],
    });
    expect(out.ankor).toEqual({ ank_1: "Brun clair" });
  });

  it("Faire : indexe par faireVariantId (le snapshot est indexé par SKU)", () => {
    const snapshot = {
      variants: {
        "SKU-A": { faireVariantId: "po_a", colorOption: "Or" },
        "SKU-B": { faireVariantId: "po_b", colorOption: "Argent" },
        "SKU-C": { colorOption: "Bronze" }, // pas de faireVariantId
        "SKU-D": { faireVariantId: "po_d", colorOption: " " },
      },
    };
    const out = extractLiveMarketplaceColorLabels({
      pfsSnapshot: null,
      ankorsSnapshot: null,
      faireSnapshot: snapshot,
      pfsColorOptions: [],
    });
    expect(out.faire).toEqual({ po_a: "Or", po_b: "Argent" });
  });

  it("eFashion : toujours vide (snapshot ne stocke pas la couleur)", () => {
    const out = extractLiveMarketplaceColorLabels({
      pfsSnapshot: null,
      ankorsSnapshot: null,
      faireSnapshot: null,
      pfsColorOptions: [],
    });
    expect(out.efashion).toEqual({});
  });

  it("Snapshots null / mal formés : retourne des maps vides sans planter", () => {
    const out = extractLiveMarketplaceColorLabels({
      pfsSnapshot: null,
      ankorsSnapshot: "junk",
      faireSnapshot: 42,
      pfsColorOptions,
    });
    expect(out.pfs).toEqual({});
    expect(out.ankor).toEqual({});
    expect(out.faire).toEqual({});
  });
});
