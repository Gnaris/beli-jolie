/**
 * Vérifie que pfsUpdateProductInPlace bascule sur une désactivation
 * (is_active=false + stock_qty=0) quand PFS refuse la suppression d'une variante
 * (cas typique : variante déjà vendue, PFS la verrouille).
 *
 * Deux scénarios couverts :
 *   1. Variante retirée localement (variantsToDelete)
 *   2. Variante dont la couleur PFS change → recreate (variantsToRecreate)
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const {
  mockFindUnique,
  mockProductUpdate,
  productColorUpdateSpy,
  productColorUpdateManySpy,
  pfsTranslateSpy,
  pfsUpdateProductSpy,
  pfsGetVariantsSpy,
  pfsPatchVariantsSpy,
  pfsDeleteVariantSpy,
  pfsCreateVariantsSpy,
  pfsUpdateStatusSpy,
} = vi.hoisted(() => ({
  mockFindUnique: vi.fn(),
  mockProductUpdate: vi.fn().mockResolvedValue({}),
  productColorUpdateSpy: vi.fn().mockResolvedValue({}),
  productColorUpdateManySpy: vi.fn().mockResolvedValue({}),
  pfsTranslateSpy: vi.fn().mockResolvedValue({
    productName: { fr: "Bague" },
    productDescription: { fr: "Description du produit assez longue pour passer." },
  }),
  pfsUpdateProductSpy: vi.fn().mockResolvedValue({}),
  pfsGetVariantsSpy: vi.fn().mockResolvedValue({ data: [] }),
  pfsPatchVariantsSpy: vi.fn().mockResolvedValue({}),
  pfsDeleteVariantSpy: vi.fn().mockResolvedValue({}),
  pfsCreateVariantsSpy: vi.fn().mockResolvedValue({ variantIds: [] }),
  pfsUpdateStatusSpy: vi.fn().mockResolvedValue({}),
}));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    product: {
      findUnique: (...a: unknown[]) => mockFindUnique(...a),
      update: (...a: unknown[]) => mockProductUpdate(...a),
    },
    productColor: {
      update: (...a: unknown[]) => productColorUpdateSpy(...a),
      updateMany: (...a: unknown[]) => productColorUpdateManySpy(...a),
    },
    companyInfo: { findFirst: vi.fn() },
    siteConfig: {
      findFirst: vi.fn().mockResolvedValue(null),
      findUnique: vi.fn().mockResolvedValue(null),
    },
    $transaction: (calls: unknown[]) => Promise.all(calls as Promise<unknown>[]),
  },
}));

vi.mock("@/lib/pfs-api", () => ({
  pfsGetVariants: pfsGetVariantsSpy,
}));

vi.mock("@/lib/pfs-api-write", () => ({
  pfsUpdateProduct: pfsUpdateProductSpy,
  pfsCreateVariants: pfsCreateVariantsSpy,
  pfsPatchVariants: pfsPatchVariantsSpy,
  pfsDeleteVariant: pfsDeleteVariantSpy,
  pfsUploadImage: vi.fn(),
  pfsDeleteImage: vi.fn(),
  pfsUpdateStatus: pfsUpdateStatusSpy,
  pfsRemoveStar: vi.fn(),
  pfsTranslate: pfsTranslateSpy,
  pfsGetCategories: vi.fn().mockResolvedValue([]),
  pfsGetFamilies: vi.fn().mockResolvedValue([]),
  pfsGetColors: vi.fn().mockResolvedValue([
    { reference: "RED", labels: { fr: "Rouge" } },
    { reference: "BLUE", labels: { fr: "Bleu" } },
  ]),
}));

vi.mock("@/lib/marketplace-pricing", () => ({
  applyMarketplaceMarkup: vi.fn((p: number) => p),
  loadMarketplaceMarkupConfigs: vi.fn().mockResolvedValue({ pfs: undefined }),
}));

vi.mock("sharp", () => ({
  default: () => ({ jpeg: () => ({ toBuffer: () => Promise.resolve(Buffer.from("j")) }) }),
}));

vi.mock("next/cache", () => ({
  revalidateTag: vi.fn(),
  unstable_cache: <T extends (...args: unknown[]) => unknown>(fn: T) => fn,
}));
vi.mock("@/lib/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));
vi.mock("@/lib/product-events", () => ({ emitProductEvent: vi.fn() }));
vi.mock("@/lib/product-primary-color", () => ({
  getProductPrimaryColorId: vi.fn(() => "color-red"),
}));
vi.mock("@/lib/pfs-brand", () => ({
  requirePfsBrand: vi.fn().mockResolvedValue({ id: "BRAND-1", name: "Beli & Jolie" }),
  PfsBrandRequiredError: class PfsBrandRequiredError extends Error {},
}));

import { pfsUpdateProductInPlace } from "@/lib/pfs-update";

function baseProduct() {
  return {
    id: "p-1",
    reference: "REF-A366",
    name: "Bague A366",
    description: "Description du produit assez longue pour passer.",
    status: "ONLINE",
    isBestSeller: false,
    primaryColorId: "color-red",
    pfsProductId: "pfs_A366",
    pfsLastSyncSnapshot: null,
    dimensionLength: null,
    dimensionWidth: null,
    dimensionHeight: null,
    dimensionDiameter: null,
    dimensionCircumference: null,
    sizeDetailsTu: null,
    category: {
      id: "cat-1",
      pfsCategoryId: "cat_1",
      pfsGender: "WOMAN",
      pfsFamilyId: "fam_1",
      pfsFamilyName: "Bijoux",
      pfsCategoryName: "Bagues",
    },
    colors: [
      {
        id: "v-red",
        pfsVariantId: "var_red",
        unitPrice: 10,
        weight: 0.1,
        stock: 5,
        isPrimary: true,
        saleType: "UNIT",
        packQuantity: null,
        variantSizes: [{ size: { name: "M", pfsSizeRef: "M" }, quantity: 1 }],
        colorId: "color-red",
        color: { id: "color-red", name: "Rouge", pfsColorRef: "RED" },
        pfsColorRefOverride: null,
        packLines: [],
        images: [],
      },
    ],
    // Une image par couleur — sinon `filterVariantsWithImages` (cf.
    // lib/pfs-update.ts) exclut toutes les variantes du test.
    colorImages: [{ path: "/mock/red.jpg", order: 0, colorId: "color-red" }],
    compositions: [{ percentage: 100, composition: { pfsCompositionRef: "COTON" } }],
    countryIsoCode: "CN",
    season: { pfsRef: "PE2026" },
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  pfsDeleteVariantSpy.mockResolvedValue({});
  pfsPatchVariantsSpy.mockResolvedValue({});
  pfsCreateVariantsSpy.mockResolvedValue({ variantIds: [] });
});

describe("pfsUpdateProductInPlace — fallback désactivation quand DELETE refusé", () => {
  it("variante retirée localement : si PFS refuse DELETE, on patche is_active=false + stock=0", async () => {
    // Local : 1 variante (Rouge). PFS : 2 variantes (Rouge + Bleu "fantôme").
    mockFindUnique.mockResolvedValue(baseProduct());
    pfsGetVariantsSpy.mockResolvedValue({
      data: [
        { id: "var_red", type: "ITEM", item: { color: { reference: "RED" }, size: "M" }, stock_qty: 5 },
        { id: "var_blue_orphan", type: "ITEM", item: { color: { reference: "BLUE" }, size: "M" }, stock_qty: 3 },
      ],
    });
    pfsDeleteVariantSpy.mockRejectedValueOnce(new Error("PFS delete variant failed (409): variant has orders"));

    const res = await pfsUpdateProductInPlace("p-1");

    expect(res.success).toBe(true);
    expect(pfsDeleteVariantSpy).toHaveBeenCalledWith("var_blue_orphan");

    // pfsPatchVariants doit avoir été appelé avec la désactivation de la variante orpheline
    const deactivationCalls = pfsPatchVariantsSpy.mock.calls.filter((call) => {
      const patches = call[0] as { variant_id: string; stock_qty?: number; is_active?: boolean }[];
      return patches.some(
        (p) => p.variant_id === "var_blue_orphan" && p.stock_qty === 0 && p.is_active === false,
      );
    });
    expect(deactivationCalls.length).toBeGreaterThan(0);

    // Snapshot final ne doit plus contenir var_blue_orphan
    const savedSnapshot = mockProductUpdate.mock.calls[0][0].data.pfsLastSyncSnapshot;
    expect(savedSnapshot.variants).not.toHaveProperty("var_blue_orphan");
  });

  it("changement de couleur : si PFS refuse DELETE de l'ancienne, on la désactive puis on crée la nouvelle", async () => {
    // Snapshot précédent : variante "var_red" en couleur BLUE.
    // Local : même variante mais maintenant en couleur RED → recreate.
    const previousSnapshot = {
      schemaVersion: 1,
      product: {
        reference: "REF-A366",
        nameSource: "Bague A366",
        descSource: "Description du produit assez longue pour passer.",
        dimensions: "",
        composition: [{ id: "COTON", value: 100 }],
        country: "CN",
        season: "PE2026",
        gender: "WOMAN",
        category: "cat_1",
        family: "fam_1",
        sizeDetailsTu: null,
      },
      defaultColor: "RED",
      variants: {
        var_red: { price: 10, stock: 5, weight: 0.1, isActive: true, colorRef: "BLUE" },
      },
      images: {},
      status: "READY_FOR_SALE",
      isBestSeller: false,
    };
    const product = { ...baseProduct(), pfsLastSyncSnapshot: previousSnapshot };
    mockFindUnique.mockResolvedValue(product);

    // PFS connaît "var_red" en BLUE
    pfsGetVariantsSpy.mockResolvedValue({
      data: [
        { id: "var_red", type: "ITEM", item: { color: { reference: "BLUE" }, size: "M" }, stock_qty: 5 },
      ],
    });
    // PFS refuse de supprimer (variante vendue)
    pfsDeleteVariantSpy.mockRejectedValueOnce(new Error("PFS delete variant failed (409): sold"));
    // La création de la nouvelle variante réussit
    pfsCreateVariantsSpy.mockResolvedValue({ variantIds: ["var_red_new"] });

    const res = await pfsUpdateProductInPlace("p-1");

    expect(res.success).toBe(true);
    expect(pfsDeleteVariantSpy).toHaveBeenCalledWith("var_red");

    // Désactivation de l'ancienne
    const deactivationCalls = pfsPatchVariantsSpy.mock.calls.filter((call) => {
      const patches = call[0] as { variant_id: string; stock_qty?: number; is_active?: boolean }[];
      return patches.some(
        (p) => p.variant_id === "var_red" && p.stock_qty === 0 && p.is_active === false,
      );
    });
    expect(deactivationCalls.length).toBeGreaterThan(0);

    // Nouvelle variante créée avec la nouvelle couleur RED
    expect(pfsCreateVariantsSpy).toHaveBeenCalled();
    const createCall = pfsCreateVariantsSpy.mock.calls[0];
    const createdData = createCall[1] as { color: string }[];
    expect(createdData[0].color).toBe("RED");

    // BDD : la ProductColor pointe maintenant vers le nouvel id
    expect(productColorUpdateSpy).toHaveBeenCalledWith({
      where: { id: "v-red" },
      data: { pfsVariantId: "var_red_new" },
    });
  });

  it("quand DELETE réussit, on ne déclenche PAS de désactivation fantôme", async () => {
    mockFindUnique.mockResolvedValue(baseProduct());
    pfsGetVariantsSpy.mockResolvedValue({
      data: [
        { id: "var_red", type: "ITEM", item: { color: { reference: "RED" }, size: "M" }, stock_qty: 5 },
        { id: "var_blue_orphan", type: "ITEM", item: { color: { reference: "BLUE" }, size: "M" }, stock_qty: 3 },
      ],
    });
    // Cette fois DELETE réussit.

    const res = await pfsUpdateProductInPlace("p-1");

    expect(res.success).toBe(true);
    expect(pfsDeleteVariantSpy).toHaveBeenCalledWith("var_blue_orphan");

    // Aucun patch ne doit cibler var_blue_orphan
    const ghostPatch = pfsPatchVariantsSpy.mock.calls.some((call) => {
      const patches = call[0] as { variant_id: string }[];
      return patches.some((p) => p.variant_id === "var_blue_orphan");
    });
    expect(ghostPatch).toBe(false);
  });
});
