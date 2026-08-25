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

  describe("Orderchamp — nécessite `orderchampProductId` (aligné sur PFS/Ankor/eFa/Faire depuis 2026-08-24)", () => {
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

    it("exclut un produit sans `orderchampProductId` (1ʳᵉ publication passe par le badge, pas par la modale de propagation)", () => {
      const products = [
        ocProduct("p-first", ["v1"], { orderchampProductId: null }),
        ocProduct("p-linked", ["v2"], { orderchampProductId: "oc-xyz" }),
      ];
      const result = computeBulkVariantMarketplaceTargets(
        products,
        ["v1", "v2"],
        { hasPfsConfig: false, showAnkorstore: false, showOrderchamp: true },
      );
      expect(result.orderchampProducts.map((p) => p.id)).toEqual(["p-linked"]);
    });

    it("exclut les brouillons (isIncomplete) même liés", () => {
      const products = [
        ocProduct("p-draft", ["v1"], { isIncomplete: true, orderchampProductId: "oc-1" }),
        ocProduct("p-ok", ["v2"], { isIncomplete: false, orderchampProductId: "oc-2" }),
      ];
      const result = computeBulkVariantMarketplaceTargets(
        products,
        ["v1", "v2"],
        { hasPfsConfig: false, showAnkorstore: false, showOrderchamp: true },
      );
      expect(result.orderchampProducts.map((p) => p.id)).toEqual(["p-ok"]);
    });

    it("exclut les produits dont le toggle produit `orderchampEnabled` est OFF même liés", () => {
      const products = [
        ocProduct("p-off", ["v1"], { orderchampEnabled: false, orderchampProductId: "oc-1" }),
        ocProduct("p-on", ["v2"], { orderchampEnabled: true, orderchampProductId: "oc-2" }),
      ];
      const result = computeBulkVariantMarketplaceTargets(
        products,
        ["v1", "v2"],
        { hasPfsConfig: false, showAnkorstore: false, showOrderchamp: true },
      );
      expect(result.orderchampProducts.map((p) => p.id)).toEqual(["p-on"]);
    });

    it("retourne une liste vide si `showOrderchamp` est false", () => {
      const products = [ocProduct("p-ok", ["v1"], { orderchampProductId: "oc-1" })];
      const result = computeBulkVariantMarketplaceTargets(
        products,
        ["v1"],
        { hasPfsConfig: false, showAnkorstore: false, showOrderchamp: false },
      );
      expect(result.orderchampProducts).toEqual([]);
    });
  });

  describe("Microstore — nécessite `microstoreLastPushedAt` (aligné sur PFS/Ankor/eFa/Faire/OC depuis 2026-08-25)", () => {
    const msProduct = (
      id: string,
      variantIds: string[],
      opts: {
        microstoreEnabled?: boolean;
        microstoreLastPushedAt?: Date | string | null;
        isIncomplete?: boolean;
      } = {},
    ) => ({
      id,
      pfsProductId: null,
      ankorsProductId: null,
      faireProductId: null,
      orderchampProductId: null,
      microstoreEnabled: opts.microstoreEnabled ?? true,
      microstoreLastPushedAt: opts.microstoreLastPushedAt ?? null,
      isIncomplete: opts.isIncomplete ?? false,
      colors: variantIds.map((vId) => ({ id: vId, efashionProductId: null })),
    });

    it("exclut un produit jamais poussé sur Microstore (1ʳᵉ publication passe par le badge « M » de la fiche, pas par la modale post-modification)", () => {
      const products = [
        msProduct("p-first", ["v1"], { microstoreLastPushedAt: null }),
        msProduct("p-linked", ["v2"], { microstoreLastPushedAt: "2026-08-01T10:00:00Z" }),
      ];
      const result = computeBulkVariantMarketplaceTargets(
        products,
        ["v1", "v2"],
        { hasPfsConfig: false, showAnkorstore: false, showMicrostore: true },
      );
      expect(result.microstoreProducts.map((p) => p.id)).toEqual(["p-linked"]);
    });

    it("exclut les brouillons (isIncomplete) même déjà poussés", () => {
      const products = [
        msProduct("p-draft", ["v1"], {
          isIncomplete: true,
          microstoreLastPushedAt: "2026-08-01T10:00:00Z",
        }),
        msProduct("p-ok", ["v2"], {
          isIncomplete: false,
          microstoreLastPushedAt: "2026-08-01T10:00:00Z",
        }),
      ];
      const result = computeBulkVariantMarketplaceTargets(
        products,
        ["v1", "v2"],
        { hasPfsConfig: false, showAnkorstore: false, showMicrostore: true },
      );
      expect(result.microstoreProducts.map((p) => p.id)).toEqual(["p-ok"]);
    });

    it("exclut les produits dont le toggle `microstoreEnabled` est OFF même déjà poussés", () => {
      const products = [
        msProduct("p-off", ["v1"], {
          microstoreEnabled: false,
          microstoreLastPushedAt: "2026-08-01T10:00:00Z",
        }),
        msProduct("p-on", ["v2"], {
          microstoreEnabled: true,
          microstoreLastPushedAt: "2026-08-01T10:00:00Z",
        }),
      ];
      const result = computeBulkVariantMarketplaceTargets(
        products,
        ["v1", "v2"],
        { hasPfsConfig: false, showAnkorstore: false, showMicrostore: true },
      );
      expect(result.microstoreProducts.map((p) => p.id)).toEqual(["p-on"]);
    });

    it("retourne une liste vide si `showMicrostore` est false", () => {
      const products = [
        msProduct("p-ok", ["v1"], { microstoreLastPushedAt: "2026-08-01T10:00:00Z" }),
      ];
      const result = computeBulkVariantMarketplaceTargets(
        products,
        ["v1"],
        { hasPfsConfig: false, showAnkorstore: false, showMicrostore: false },
      );
      expect(result.microstoreProducts).toEqual([]);
    });
  });
});
