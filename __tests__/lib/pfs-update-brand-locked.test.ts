/**
 * Vérifie que pfsUpdateProductInPlace n'envoie JAMAIS le champ brand_name
 * dans le payload PATCH PFS — la marque d'un produit publié est verrouillée
 * par construction.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const {
  mockFindUnique,
  mockProductUpdate,
  pfsTranslateSpy,
  pfsUpdateProductSpy,
  pfsGetVariantsSpy,
  pfsPatchVariantsSpy,
  pfsUpdateStatusSpy,
  requirePfsBrandSpy,
} = vi.hoisted(() => ({
  mockFindUnique: vi.fn(),
  mockProductUpdate: vi.fn().mockResolvedValue({}),
  pfsTranslateSpy: vi.fn().mockResolvedValue({
    productName: { fr: "Bague" },
    productDescription: { fr: "Nouvelle description du produit assez longue." },
  }),
  pfsUpdateProductSpy: vi.fn().mockResolvedValue({}),
  pfsGetVariantsSpy: vi.fn().mockResolvedValue({ data: [] }),
  pfsPatchVariantsSpy: vi.fn().mockResolvedValue({}),
  pfsUpdateStatusSpy: vi.fn().mockResolvedValue({}),
  requirePfsBrandSpy: vi
    .fn()
    .mockResolvedValue({ id: "BRAND-1", name: "Beli & Jolie" }),
}));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    product: {
      findUnique: (...a: unknown[]) => mockFindUnique(...a),
      update: (...a: unknown[]) => mockProductUpdate(...a),
    },
    productColor: { update: vi.fn(), updateMany: vi.fn() },
    companyInfo: { findFirst: vi.fn() },
  },
}));

vi.mock("@/lib/pfs-api", () => ({
  pfsGetVariants: pfsGetVariantsSpy,
}));

vi.mock("@/lib/pfs-api-write", () => ({
  pfsUpdateProduct: pfsUpdateProductSpy,
  pfsCreateVariants: vi.fn().mockResolvedValue({ variantIds: [] }),
  pfsPatchVariants: pfsPatchVariantsSpy,
  pfsDeleteVariant: vi.fn(),
  pfsUploadImage: vi.fn(),
  pfsDeleteImage: vi.fn(),
  pfsUpdateStatus: pfsUpdateStatusSpy,
  pfsRemoveStar: vi.fn(),
  pfsTranslate: pfsTranslateSpy,
  pfsGetCategories: vi.fn().mockResolvedValue([]),
  pfsGetFamilies: vi.fn().mockResolvedValue([]),
  pfsGetColors: vi.fn().mockResolvedValue([]),
}));

vi.mock("@/lib/marketplace-pricing", () => ({
  applyMarketplaceMarkup: vi.fn((p: number) => p),
  loadMarketplaceMarkupConfigs: vi.fn().mockResolvedValue({ pfs: undefined }),
}));

vi.mock("sharp", () => ({
  default: () => ({ jpeg: () => ({ toBuffer: () => Promise.resolve(Buffer.from("j")) }) }),
}));

vi.mock("next/cache", () => ({ revalidateTag: vi.fn() }));
vi.mock("@/lib/logger", () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));
vi.mock("@/lib/product-events", () => ({ emitProductEvent: vi.fn() }));
vi.mock("@/lib/product-primary-color", () => ({
  getProductPrimaryColorId: vi.fn(() => "color-noir"),
}));

vi.mock("@/lib/pfs-brand", () => ({
  requirePfsBrand: requirePfsBrandSpy,
  PfsBrandRequiredError: class PfsBrandRequiredError extends Error {},
}));

import { pfsUpdateProductInPlace } from "@/lib/pfs-update";

function mkProduct() {
  return {
    id: "p-1",
    reference: "REF-1",
    name: "Bague étoile",
    // Description différente d'un snapshot bidon → forcera productChanged=true
    description: "Description modifiée du produit assez longue pour passer.",
    status: "ONLINE",
    isBestSeller: false,
    primaryColorId: "color-noir",
    pfsProductId: "pfs_123",
    // Aucun snapshot précédent → diff complet → on envoie tous les champs (sauf brand)
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
        id: "v-1",
        pfsVariantId: "var_1",
        unitPrice: 10,
        weight: 0.1,
        stock: 5,
        isPrimary: true,
        saleType: "UNIT",
        packQuantity: null,
        variantSizes: [{ size: { name: "M", pfsSizeRef: "M" }, quantity: 1 }],
        colorId: "color-noir",
        color: { id: "color-noir", name: "Noir", pfsColorRef: null },
        packLines: [],
        images: [],
      },
    ],
    colorImages: [],
    compositions: [{ percentage: 100, composition: { pfsCompositionRef: "COTON" } }],
    manufacturingCountry: { isoCode: "CN", pfsCountryRef: "CN" },
    season: { pfsRef: "PE2026" },
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("pfsUpdateProductInPlace — brand verrouillée", () => {
  it("n'inclut JAMAIS brand_name dans le payload PATCH", async () => {
    mockFindUnique.mockResolvedValue(mkProduct());

    const res = await pfsUpdateProductInPlace("p-1");

    expect(res.success).toBe(true);
    expect(pfsUpdateProductSpy).toHaveBeenCalled();
    // pfsUpdateProduct est appelée plusieurs fois (status, rename...).
    // On vérifie qu'aucun appel ne contient brand_name.
    for (const call of pfsUpdateProductSpy.mock.calls) {
      const payload = call[1] as Record<string, unknown>;
      expect(payload).not.toHaveProperty("brand_name");
    }
  });

  it("propage l'erreur si aucune marque n'est sélectionnée", async () => {
    class FakeErr extends Error {
      constructor() {
        super("Aucune marque PFS sélectionnée.");
        this.name = "PfsBrandRequiredError";
      }
    }
    requirePfsBrandSpy.mockRejectedValueOnce(new FakeErr());
    mockFindUnique.mockResolvedValue(mkProduct());

    await expect(pfsUpdateProductInPlace("p-1")).rejects.toThrow(/marque PFS/i);
  });
});
