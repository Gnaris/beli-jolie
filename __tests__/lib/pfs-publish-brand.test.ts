/**
 * Vérifie au publish PFS que :
 *  - `brand_name` envoyé à PFS = la marque sélectionnée dans Paramètres
 *  - On n'utilise PLUS companyInfo.shopName comme fallback
 *  - pfsBrandId et pfsBrandName sont sauvegardés sur le produit en base
 *  - Sans marque sélectionnée, le publish échoue proprement
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const {
  mockProductFindUnique,
  mockProductUpdate,
  pfsCreateProductSpy,
  pfsCreateVariantsSpy,
  pfsUploadImageSpy,
  pfsUpdateStatusSpy,
  pfsTranslateSpy,
  requirePfsBrandSpy,
} = vi.hoisted(() => ({
  mockProductFindUnique: vi.fn(),
  mockProductUpdate: vi.fn().mockResolvedValue({}),
  pfsCreateProductSpy: vi.fn().mockResolvedValue({ pfsProductId: "new_pfs_id" }),
  pfsCreateVariantsSpy: vi.fn().mockResolvedValue({ variantIds: ["new_var_1"] }),
  pfsUploadImageSpy: vi.fn().mockResolvedValue({ imagePath: "path" }),
  pfsUpdateStatusSpy: vi.fn().mockResolvedValue(undefined),
  pfsTranslateSpy: vi.fn().mockResolvedValue({
    productName: { fr: "Bague" },
    productDescription: { fr: "Desc" },
  }),
  requirePfsBrandSpy: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    product: {
      findUnique: (...a: unknown[]) => mockProductFindUnique(...a),
      update: (...a: unknown[]) => mockProductUpdate(...a),
    },
    productColor: { update: vi.fn().mockResolvedValue({}) },
    companyInfo: {
      // ne doit PLUS être appelé pour le brand_name
      findFirst: vi.fn().mockResolvedValue({ shopName: "Ne doit pas être utilisé" }),
    },
    siteConfig: {
      findFirst: vi.fn().mockResolvedValue(null),
      findUnique: vi.fn().mockResolvedValue(null),
    },
    $transaction: vi.fn(async (operations: unknown[]) => operations),
  },
}));

vi.mock("@/lib/pfs-api-write", () => ({
  pfsCreateProduct: pfsCreateProductSpy,
  pfsUpdateProduct: vi.fn().mockResolvedValue(undefined),
  pfsCreateVariants: pfsCreateVariantsSpy,
  pfsPatchVariants: vi.fn(),
  pfsUploadImage: pfsUploadImageSpy,
  pfsUpdateStatus: pfsUpdateStatusSpy,
  pfsTranslate: pfsTranslateSpy,
  pfsGetCategories: vi.fn().mockResolvedValue([]),
  pfsGetFamilies: vi.fn().mockResolvedValue([]),
  pfsGetColors: vi.fn().mockResolvedValue([]),
}));

vi.mock("@/lib/marketplace-pricing", () => ({
  applyMarketplaceMarkup: vi.fn((price: number) => price),
  loadMarketplaceMarkupConfigs: vi.fn().mockResolvedValue({ pfs: undefined }),
}));

vi.mock("@/lib/storage", () => ({
  readFile: vi.fn().mockResolvedValue(Buffer.from("img")),
  keyFromDbPath: vi.fn((p: string) => p),
}));

vi.mock("sharp", () => ({
  default: () => ({
    jpeg: () => ({ toBuffer: () => Promise.resolve(Buffer.from("jpeg")) }),
  }),
}));

vi.mock("next/cache", () => ({
  revalidateTag: vi.fn(),
  unstable_cache: <T extends (...args: unknown[]) => unknown>(fn: T) => fn,
}));
vi.mock("@/lib/pfs-out-of-stock-config", () => ({
  getPfsOutOfStockConfig: vi.fn().mockResolvedValue({ deactivateVariant: true }),
  PFS_OUT_OF_STOCK_DEFAULTS: { deactivateVariant: true },
}));
vi.mock("@/lib/logger", () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));
vi.mock("@/lib/product-events", () => ({ emitProductEvent: vi.fn() }));
vi.mock("@/lib/product-primary-color", () => ({
  getProductPrimaryColorId: vi.fn(() => "color-noir"),
}));

vi.mock("@/lib/pfs-brand", () => ({
  requirePfsBrand: requirePfsBrandSpy,
  PfsBrandRequiredError: class PfsBrandRequiredError extends Error {
    constructor() {
      super("brand required");
      this.name = "PfsBrandRequiredError";
    }
  },
}));

import { pfsPublishProduct } from "@/lib/pfs-publish";

function mkProduct() {
  return {
    id: "p-1",
    reference: "REF-1",
    name: "Bague étoile",
    description: "Une jolie bague étoile pour briller au quotidien.",
    status: "ONLINE",
    isBestSeller: false,
    primaryColorId: "color-noir",
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
        images: [{ path: "/uploads/products/a.webp", order: 0, colorId: "color-noir" }],
      },
    ],
    colorImages: [{ path: "/uploads/products/a.webp", order: 0, colorId: "color-noir" }],
    compositions: [{ percentage: 100, composition: { pfsCompositionRef: "COTON" } }],
    countryIsoCode: "CN",
    season: { pfsRef: "PE2026" },
    pfsBrandId: null,
    pfsBrandName: null,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("pfsPublishProduct — marque", () => {
  it("envoie brand_name = nom de la marque sélectionnée (pas le shopName)", async () => {
    requirePfsBrandSpy.mockResolvedValue({ id: "BRAND-1", name: "Beli & Jolie" });
    mockProductFindUnique.mockResolvedValue(mkProduct());

    const res = await pfsPublishProduct("p-1");

    expect(res.success).toBe(true);
    expect(pfsCreateProductSpy).toHaveBeenCalledTimes(1);
    const payload = pfsCreateProductSpy.mock.calls[0][0] as { brand_name: string };
    expect(payload.brand_name).toBe("Beli & Jolie");
    expect(payload.brand_name).not.toBe("Ne doit pas être utilisé");
  });

  it("sauvegarde pfsBrandId et pfsBrandName sur le produit après succès", async () => {
    requirePfsBrandSpy.mockResolvedValue({ id: "BRAND-1", name: "Beli & Jolie" });
    mockProductFindUnique.mockResolvedValue(mkProduct());

    await pfsPublishProduct("p-1");

    const updateCall = mockProductUpdate.mock.calls.find((c) => {
      const data = (c[0] as { data?: { pfsBrandId?: string } }).data;
      return data?.pfsBrandId != null;
    });
    expect(updateCall).toBeDefined();
    const data = (updateCall![0] as { data: { pfsBrandId: string; pfsBrandName: string } }).data;
    expect(data.pfsBrandId).toBe("BRAND-1");
    expect(data.pfsBrandName).toBe("Beli & Jolie");
  });

  it("propage l'erreur quand aucune marque n'est sélectionnée", async () => {
    class FakeErr extends Error {
      constructor() {
        super("Aucune marque PFS sélectionnée.");
        this.name = "PfsBrandRequiredError";
      }
    }
    requirePfsBrandSpy.mockRejectedValue(new FakeErr());
    mockProductFindUnique.mockResolvedValue(mkProduct());

    await expect(pfsPublishProduct("p-1")).rejects.toThrow(/marque PFS/i);
    expect(pfsCreateProductSpy).not.toHaveBeenCalled();
  });
});
