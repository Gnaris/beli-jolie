import { describe, it, expect } from "vitest";
import { computeBulkVariantMarketplaceTargets } from "@/lib/bulk-variant-marketplace-targets";

const product = (
  id: string,
  pfsProductId: string | null,
  ankorsProductId: string | null,
  variantIds: string[],
) => ({
  id,
  pfsProductId,
  ankorsProductId,
  colors: variantIds.map((vId) => ({ id: vId })),
});

describe("computeBulkVariantMarketplaceTargets", () => {
  it("ne retient que les produits touches par les variantes sélectionnées", () => {
    const products = [
      product("p1", "pfs-1", null, ["v1", "v2"]),
      product("p2", "pfs-2", "ank-2", ["v3"]),
      product("p3", null, "ank-3", ["v4"]),
    ];
    const result = computeBulkVariantMarketplaceTargets(
      products,
      ["v1", "v3"],
      { hasPfsConfig: true, showAnkorstore: true },
    );
    expect(result.affectedProducts.map((p) => p.id)).toEqual(["p1", "p2"]);
    expect(result.pfsProducts.map((p) => p.id)).toEqual(["p1", "p2"]);
    expect(result.ankorsProducts.map((p) => p.id)).toEqual(["p2"]);
  });

  it("ignore PFS quand la marketplace n'est pas configurée", () => {
    const products = [product("p1", "pfs-1", "ank-1", ["v1"])];
    const result = computeBulkVariantMarketplaceTargets(
      products,
      ["v1"],
      { hasPfsConfig: false, showAnkorstore: true },
    );
    expect(result.pfsProducts).toEqual([]);
    expect(result.ankorsProducts.map((p) => p.id)).toEqual(["p1"]);
  });

  it("ignore Ankorstore quand la marketplace n'est pas activée (kill switch off)", () => {
    const products = [product("p1", "pfs-1", "ank-1", ["v1"])];
    const result = computeBulkVariantMarketplaceTargets(
      products,
      ["v1"],
      { hasPfsConfig: true, showAnkorstore: false },
    );
    expect(result.pfsProducts.map((p) => p.id)).toEqual(["p1"]);
    expect(result.ankorsProducts).toEqual([]);
  });

  it("ignore les produits non encore publiés sur la marketplace", () => {
    const products = [
      product("p1", null, null, ["v1"]),
      product("p2", "pfs-2", null, ["v2"]),
    ];
    const result = computeBulkVariantMarketplaceTargets(
      products,
      ["v1", "v2"],
      { hasPfsConfig: true, showAnkorstore: true },
    );
    expect(result.affectedProducts.map((p) => p.id)).toEqual(["p1", "p2"]);
    expect(result.pfsProducts.map((p) => p.id)).toEqual(["p2"]);
    expect(result.ankorsProducts).toEqual([]);
  });

  it("dédoublonne quand plusieurs variantes appartiennent au même produit", () => {
    const products = [product("p1", "pfs-1", "ank-1", ["v1", "v2", "v3"])];
    const result = computeBulkVariantMarketplaceTargets(
      products,
      ["v1", "v2", "v3"],
      { hasPfsConfig: true, showAnkorstore: true },
    );
    expect(result.affectedProducts).toHaveLength(1);
    expect(result.pfsProducts).toHaveLength(1);
    expect(result.ankorsProducts).toHaveLength(1);
  });

  it("retourne des listes vides quand aucune variante n'est sélectionnée", () => {
    const products = [product("p1", "pfs-1", "ank-1", ["v1"])];
    const result = computeBulkVariantMarketplaceTargets(
      products,
      [],
      { hasPfsConfig: true, showAnkorstore: true },
    );
    expect(result.affectedProducts).toEqual([]);
    expect(result.pfsProducts).toEqual([]);
    expect(result.ankorsProducts).toEqual([]);
  });

  it("ignore les variantIds qui ne correspondent à aucun produit", () => {
    const products = [product("p1", "pfs-1", null, ["v1"])];
    const result = computeBulkVariantMarketplaceTargets(
      products,
      ["v1", "v999-fantôme"],
      { hasPfsConfig: true, showAnkorstore: true },
    );
    expect(result.affectedProducts.map((p) => p.id)).toEqual(["p1"]);
  });
});
