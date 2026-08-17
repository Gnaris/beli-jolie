/**
 * Vérifie le garde-fou d'adoption : quand une variante BJ vient d'être créée
 * (donc sans pfsVariantId) mais qu'une variante PFS orpheline a exactement le
 * même mapping couleur (et taille / signature de pack), on RÉUTILISE l'ID PFS
 * au lieu de tenter un delete + create qui échoue systématiquement.
 *
 * Scénario reproduit (bug E292 constaté le 2026-08-17) :
 *   - Cliente supprime la variante « Rouge » puis en recrée une nouvelle
 *     avec le même mapping PFS = RED
 *   - Ancienne variante côté PFS n'est plus référencée localement
 *   - Nouvelle variante locale n'a pas encore de pfsVariantId
 *   - Sans garde-fou : PFS refuse la création (couleur déjà prise) + refuse la
 *     suppression (article vendu) → variante zombie désactivée
 *   - Avec garde-fou : on réutilise l'ID PFS existant → patch stock/prix
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
    productDescription: { fr: "Description assez longue pour passer les checks." },
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

function baseProduct(overrides: Partial<ReturnType<typeof baseProduct>> = {}) {
  return {
    id: "p-1",
    reference: "REF-ADOPT",
    name: "Bague test",
    description: "Description assez longue pour passer les checks.",
    status: "ONLINE",
    isBestSeller: false,
    primaryColorId: "color-red",
    pfsProductId: "pfs_prod",
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
        id: "v-red-local",
        // Aucun pfsVariantId : la variante vient d'être créée localement
        pfsVariantId: null,
        unitPrice: 10,
        weight: 0.1,
        stock: 42,
        isPrimary: true,
        disabled: false,
        saleType: "UNIT",
        packQuantity: null,
        variantSizes: [{ size: { name: "TU", pfsSizeRef: "TU" }, quantity: 1 }],
        colorId: "color-red",
        color: { id: "color-red", name: "Rouge", pfsColorRef: "RED" },
        pfsColorRefOverride: null,
        packLines: [],
        images: [],
      },
    ],
    colorImages: [{ path: "/mock/red.jpg", order: 0, colorId: "color-red" }],
    compositions: [{ percentage: 100, composition: { pfsCompositionRef: "COTON" } }],
    countryIsoCode: "CN",
    season: { pfsRef: "PE2026" },
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  pfsDeleteVariantSpy.mockResolvedValue({});
  pfsPatchVariantsSpy.mockResolvedValue({});
  pfsCreateVariantsSpy.mockResolvedValue({ variantIds: [] });
});

describe("pfsUpdateProductInPlace — adoption d'une variante PFS orpheline", () => {
  it("réutilise l'ID PFS existant quand le colorRef matche (au lieu de delete+create)", async () => {
    mockFindUnique.mockResolvedValue(baseProduct());
    // PFS a une variante RED orpheline (héritée d'une ancienne variante BJ
    // supprimée). Sans le garde-fou, on tenterait de la supprimer et de créer
    // une nouvelle RED côté PFS → PFS refuse les deux → zombie désactivée.
    pfsGetVariantsSpy.mockResolvedValue({
      data: [
        {
          id: "var_red_orphan",
          type: "ITEM",
          item: { color: { reference: "RED" }, size: "TU" },
          stock_qty: 0,
        },
      ],
    });

    const res = await pfsUpdateProductInPlace("p-1");
    expect(res.success).toBe(true);

    // La variante orpheline n'est PAS supprimée (adoption au lieu de delete)
    expect(pfsDeleteVariantSpy).not.toHaveBeenCalled();
    // Aucune création : on a réutilisé l'existante
    expect(pfsCreateVariantsSpy).not.toHaveBeenCalled();
    // La ProductColor locale a été branchée sur l'ID PFS existant
    expect(productColorUpdateSpy).toHaveBeenCalledWith({
      where: { id: "v-red-local" },
      data: { pfsVariantId: "var_red_orphan" },
    });
    // Patch d'alignement (stock/prix/is_active=true) sur la variante adoptée
    const patchCalls = pfsPatchVariantsSpy.mock.calls.filter((call) => {
      const patches = call[0] as { variant_id: string; stock_qty?: number; is_active?: boolean }[];
      return patches.some(
        (p) => p.variant_id === "var_red_orphan" && p.stock_qty === 42 && p.is_active === true,
      );
    });
    expect(patchCalls.length).toBeGreaterThan(0);
  });

  it("ne matche pas si le colorRef diffère : delete + create classique", async () => {
    mockFindUnique.mockResolvedValue(baseProduct());
    // PFS orpheline BLUE alors que la locale est RED : pas de match, on retombe
    // sur le flow habituel (delete BLUE, create RED).
    pfsGetVariantsSpy.mockResolvedValue({
      data: [
        {
          id: "var_blue_orphan",
          type: "ITEM",
          item: { color: { reference: "BLUE" }, size: "TU" },
          stock_qty: 0,
        },
      ],
    });
    pfsCreateVariantsSpy.mockResolvedValue({ variantIds: ["var_red_new"] });

    const res = await pfsUpdateProductInPlace("p-1");
    expect(res.success).toBe(true);

    expect(pfsDeleteVariantSpy).toHaveBeenCalledWith("var_blue_orphan");
    expect(pfsCreateVariantsSpy).toHaveBeenCalled();
    const createArgs = pfsCreateVariantsSpy.mock.calls[0]![1] as { color: string }[];
    expect(createArgs[0].color).toBe("RED");
    // La ProductColor pointe vers la nouvelle variante créée
    expect(productColorUpdateSpy).toHaveBeenCalledWith({
      where: { id: "v-red-local" },
      data: { pfsVariantId: "var_red_new" },
    });
  });

  it("ne matche pas si la taille diffère : delete + create classique", async () => {
    mockFindUnique.mockResolvedValue(baseProduct());
    // Même couleur RED mais orpheline en taille M — la locale est en TU.
    pfsGetVariantsSpy.mockResolvedValue({
      data: [
        {
          id: "var_red_m_orphan",
          type: "ITEM",
          item: { color: { reference: "RED" }, size: "M" },
          stock_qty: 0,
        },
      ],
    });
    pfsCreateVariantsSpy.mockResolvedValue({ variantIds: ["var_red_tu_new"] });

    const res = await pfsUpdateProductInPlace("p-1");
    expect(res.success).toBe(true);

    expect(pfsDeleteVariantSpy).toHaveBeenCalledWith("var_red_m_orphan");
    expect(pfsCreateVariantsSpy).toHaveBeenCalled();
  });
});
