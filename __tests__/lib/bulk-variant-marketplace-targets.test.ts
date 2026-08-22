import { describe, it, expect } from "vitest";
import { computeBulkVariantMarketplaceTargets } from "@/lib/bulk-variant-marketplace-targets";

const product = (
  id: string,
  pfsProductId: string | null,
  ankorsProductId: string | null,
  variantIds: string[],
  efashionVariantIds: string[] = [],
  faireProductId: string | null = null,
) => ({
  id,
  pfsProductId,
  ankorsProductId,
  faireProductId,
  colors: variantIds.map((vId) => ({
    id: vId,
    efashionProductId: efashionVariantIds.includes(vId) ? 1 : null,
  })),
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

  it("ne retient pour eFashion que les produits liés (une couleur avec efashionProductId)", () => {
    const products = [
      product("p1", "pfs-1", null, ["v1", "v2"], ["v1"]),       // lié à eFashion
      product("p2", "pfs-2", null, ["v3"]),                     // pas lié
      product("p3", null, null, ["v4"], ["v4"]),                // lié à eFashion seul
    ];
    const result = computeBulkVariantMarketplaceTargets(
      products,
      ["v1", "v3", "v4"],
      { hasPfsConfig: true, showAnkorstore: false, showEfashion: true },
    );
    expect(result.affectedProducts.map((p) => p.id)).toEqual(["p1", "p2", "p3"]);
    expect(result.efashionProducts.map((p) => p.id)).toEqual(["p1", "p3"]);
  });

  it("ignore eFashion quand la marketplace n'est pas activée (kill switch off ou non configurée)", () => {
    const products = [product("p1", null, null, ["v1"], ["v1"])];
    const resultDisabled = computeBulkVariantMarketplaceTargets(
      products,
      ["v1"],
      { hasPfsConfig: false, showAnkorstore: false, showEfashion: false },
    );
    expect(resultDisabled.efashionProducts).toEqual([]);
    const resultMissing = computeBulkVariantMarketplaceTargets(
      products,
      ["v1"],
      { hasPfsConfig: false, showAnkorstore: false },
    );
    expect(resultMissing.efashionProducts).toEqual([]);
  });

  it("ne retient pour Faire que les produits déjà publiés (faireProductId connu)", () => {
    const products = [
      product("p1", "pfs-1", null, ["v1"], [], "faire-1"), // lié à Faire
      product("p2", "pfs-2", null, ["v2"]),                // pas lié
      product("p3", null, null, ["v3"], [], "faire-3"),    // lié à Faire seul
    ];
    const result = computeBulkVariantMarketplaceTargets(
      products,
      ["v1", "v2", "v3"],
      { hasPfsConfig: true, showAnkorstore: false, showFaire: true },
    );
    expect(result.affectedProducts.map((p) => p.id)).toEqual(["p1", "p2", "p3"]);
    expect(result.faireProducts.map((p) => p.id)).toEqual(["p1", "p3"]);
  });

  it("ignore Faire quand la marketplace n'est pas activée (kill switch off ou non configurée)", () => {
    const products = [product("p1", null, null, ["v1"], [], "faire-1")];
    const resultDisabled = computeBulkVariantMarketplaceTargets(
      products,
      ["v1"],
      { hasPfsConfig: false, showAnkorstore: false, showFaire: false },
    );
    expect(resultDisabled.faireProducts).toEqual([]);
    const resultMissing = computeBulkVariantMarketplaceTargets(
      products,
      ["v1"],
      { hasPfsConfig: false, showAnkorstore: false },
    );
    expect(resultMissing.faireProducts).toEqual([]);
  });

  describe("Orderchamp — upsert-style, pas besoin de `orderchampProductId`", () => {
    const ocProduct = (
      id: string,
      variantIds: string[],
      opts: {
        orderchampEnabled?: boolean;
        isIncomplete?: boolean;
        orderchampProductId?: string | null;
      } = {},
    ) => ({
      id,
      pfsProductId: null,
      ankorsProductId: null,
      faireProductId: null,
      orderchampProductId: opts.orderchampProductId ?? null,
      orderchampEnabled: opts.orderchampEnabled ?? true,
      isIncomplete: opts.isIncomplete ?? false,
      colors: variantIds.map((vId) => ({ id: vId, efashionProductId: null })),
    });

    it("inclut un produit complet OC-activé même sans `orderchampProductId`", () => {
      const products = [
        ocProduct("p-first", ["v1"], { orderchampProductId: null }),
        ocProduct("p-linked", ["v2"], { orderchampProductId: "oc-xyz" }),
      ];
      const result = computeBulkVariantMarketplaceTargets(
        products,
        ["v1", "v2"],
        { hasPfsConfig: false, showAnkorstore: false, showOrderchamp: true },
      );
      expect(result.orderchampProducts.map((p) => p.id)).toEqual(["p-first", "p-linked"]);
    });

    it("exclut les brouillons (isIncomplete)", () => {
      const products = [
        ocProduct("p-draft", ["v1"], { isIncomplete: true }),
        ocProduct("p-ok", ["v2"], { isIncomplete: false }),
      ];
      const result = computeBulkVariantMarketplaceTargets(
        products,
        ["v1", "v2"],
        { hasPfsConfig: false, showAnkorstore: false, showOrderchamp: true },
      );
      expect(result.orderchampProducts.map((p) => p.id)).toEqual(["p-ok"]);
    });

    it("exclut les produits dont le toggle produit `orderchampEnabled` est OFF", () => {
      const products = [
        ocProduct("p-off", ["v1"], { orderchampEnabled: false }),
        ocProduct("p-on", ["v2"], { orderchampEnabled: true }),
      ];
      const result = computeBulkVariantMarketplaceTargets(
        products,
        ["v1", "v2"],
        { hasPfsConfig: false, showAnkorstore: false, showOrderchamp: true },
      );
      expect(result.orderchampProducts.map((p) => p.id)).toEqual(["p-on"]);
    });

    it("retourne une liste vide si `showOrderchamp` est false", () => {
      const products = [ocProduct("p-ok", ["v1"])];
      const result = computeBulkVariantMarketplaceTargets(
        products,
        ["v1"],
        { hasPfsConfig: false, showAnkorstore: false, showOrderchamp: false },
      );
      expect(result.orderchampProducts).toEqual([]);
    });
  });
});
