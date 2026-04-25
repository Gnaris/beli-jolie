import { describe, it, expect, vi, beforeEach } from "vitest";

const {
  mockProductFindUnique,
  mockProductUpdate,
  mockCompanyInfoFindFirst,
  pfsCheckReferenceSpy,
  pfsCreateProductSpy,
  pfsUpdateProductSpy,
  pfsCreateVariantsSpy,
  pfsPatchVariantsSpy,
  pfsUploadImageSpy,
  pfsUpdateStatusSpy,
  pfsTranslateSpy,
} = vi.hoisted(() => ({
  mockProductFindUnique: vi.fn(),
  mockProductUpdate: vi.fn(),
  mockCompanyInfoFindFirst: vi.fn(),
  pfsCheckReferenceSpy: vi.fn(),
  pfsCreateProductSpy: vi.fn(),
  pfsUpdateProductSpy: vi.fn(),
  pfsCreateVariantsSpy: vi.fn(),
  pfsPatchVariantsSpy: vi.fn(),
  pfsUploadImageSpy: vi.fn(),
  pfsUpdateStatusSpy: vi.fn(),
  pfsTranslateSpy: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    product: {
      findUnique: (...a: unknown[]) => mockProductFindUnique(...a),
      update: (...a: unknown[]) => mockProductUpdate(...a),
    },
    companyInfo: {
      findFirst: (...a: unknown[]) => mockCompanyInfoFindFirst(...a),
    },
  },
}));

vi.mock("@/lib/pfs-api", () => ({ pfsCheckReference: pfsCheckReferenceSpy }));

vi.mock("@/lib/pfs-api-write", () => ({
  pfsCreateProduct: pfsCreateProductSpy,
  pfsUpdateProduct: pfsUpdateProductSpy,
  pfsCreateVariants: pfsCreateVariantsSpy,
  pfsPatchVariants: pfsPatchVariantsSpy,
  pfsUploadImage: pfsUploadImageSpy,
  pfsUpdateStatus: pfsUpdateStatusSpy,
  pfsTranslate: pfsTranslateSpy,
}));

vi.mock("@/lib/marketplace-pricing", () => ({
  applyMarketplaceMarkup: vi.fn((price: number) => price),
  loadMarketplaceMarkupConfigs: vi.fn().mockResolvedValue({ pfs: undefined, ankorstore: undefined }),
}));

vi.mock("@/lib/storage", () => ({
  readFile: vi.fn().mockResolvedValue(Buffer.from("fake")),
  keyFromDbPath: vi.fn((p: string) => p),
}));

vi.mock("sharp", () => ({
  default: () => ({
    jpeg: () => ({
      toBuffer: () => Promise.resolve(Buffer.from("jpeg")),
    }),
  }),
}));

vi.mock("next/cache", () => ({ revalidateTag: vi.fn() }));
vi.mock("@/lib/logger", () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));
vi.mock("@/lib/product-events", () => ({ emitProductEvent: vi.fn() }));

import { pfsRefreshProduct } from "@/lib/pfs-refresh";

function mkProduct(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: "p-1",
    reference: "REF-1",
    name: "T-shirt",
    description: "Description longue du produit qui dépasse les 30 caractères.",
    status: "ONLINE",
    dimensionLength: null,
    dimensionWidth: null,
    dimensionHeight: null,
    dimensionDiameter: null,
    dimensionCircumference: null,
    category: { pfsCategoryId: "cat_1", pfsGender: "WOMAN", pfsFamilyId: "fam_1" },
    colors: [
      {
        id: "v-1",
        pfsColorRef: null,
        unitPrice: 10,
        weight: 0.1,
        stock: 5,
        isPrimary: true,
        saleType: "UNIT",
        packQuantity: null,
        variantSizes: [{ size: { name: "M", pfsSizeRef: "M" }, quantity: 1 }],
        color: { pfsColorRef: "Noir" },
        subColors: [],
        images: [{ path: "/uploads/products/a.webp", order: 0 }],
      },
    ],
    compositions: [{ percentage: 100, composition: { pfsCompositionRef: "COTON" } }],
    manufacturingCountry: { isoCode: "CN", pfsCountryRef: "CN" },
    season: { pfsRef: "PE2026" },
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockCompanyInfoFindFirst.mockResolvedValue({ shopName: "Ma Boutique" });
  pfsTranslateSpy.mockResolvedValue({
    productName: { fr: "T-shirt" },
    productDescription: { fr: "Desc" },
  });
});

describe("pfsRefreshProduct", () => {
  it("returns error when product does not exist locally", async () => {
    mockProductFindUnique.mockResolvedValue(null);

    const res = await pfsRefreshProduct("missing");

    expect(res.success).toBe(false);
    if (!res.success) expect(res.reason).toBe("error");
    expect(pfsCheckReferenceSpy).not.toHaveBeenCalled();
  });

  it("returns not_found when product does not exist on PFS", async () => {
    mockProductFindUnique.mockResolvedValue(mkProduct());
    pfsCheckReferenceSpy.mockResolvedValue({ exists: false });

    const res = await pfsRefreshProduct("p-1");

    expect(res.success).toBe(false);
    if (!res.success) {
      expect(res.reason).toBe("not_found");
      expect(res.error).toMatch(/inexistant/i);
    }
    expect(pfsCreateProductSpy).not.toHaveBeenCalled();
  });

  it("happy path — creates new, uploads images, renames old to DELETED, promotes new", async () => {
    mockProductFindUnique.mockResolvedValue(mkProduct());
    pfsCheckReferenceSpy.mockResolvedValue({
      exists: true,
      product: {
        id: "old_pfs_id",
        brand: { name: "Ma Boutique" },
        gender: { reference: "WOMAN" },
        family: { id: "fam_1" },
      },
    });
    pfsCreateProductSpy.mockResolvedValue({ pfsProductId: "new_pfs_id" });
    pfsCreateVariantsSpy.mockResolvedValue({ variantIds: ["new_var_1"] });
    pfsUploadImageSpy.mockResolvedValue({ imagePath: "img_path" });
    pfsUpdateProductSpy.mockResolvedValue(undefined);
    pfsUpdateStatusSpy.mockResolvedValue(undefined);
    mockProductUpdate.mockResolvedValue({});

    const res = await pfsRefreshProduct("p-1");

    expect(res.success).toBe(true);
    if (res.success) {
      expect(res.newPfsProductId).toBe("new_pfs_id");
      expect(res.archived).toBe(false);
    }

    expect(pfsCreateProductSpy).toHaveBeenCalledTimes(1);
    expect(pfsCreateVariantsSpy).toHaveBeenCalledTimes(1);
    expect(pfsUploadImageSpy).toHaveBeenCalledTimes(1);

    // Old renamed + DELETED
    expect(pfsUpdateProductSpy).toHaveBeenCalledWith("old_pfs_id", expect.objectContaining({
      reference_code: expect.any(String),
    }));
    expect(pfsUpdateStatusSpy).toHaveBeenCalledWith([{ id: "old_pfs_id", status: "DELETED" }]);

    // New renamed to real ref + READY_FOR_SALE
    expect(pfsUpdateProductSpy).toHaveBeenCalledWith("new_pfs_id", { reference_code: "REF-1" });
    expect(pfsUpdateStatusSpy).toHaveBeenCalledWith([{ id: "new_pfs_id", status: "READY_FOR_SALE" }]);

    // Local DB sets lastRefreshedAt (not createdAt)
    const updateCall = mockProductUpdate.mock.calls.find((c) =>
      (c[0] as { data?: { lastRefreshedAt?: Date } }).data?.lastRefreshedAt != null,
    );
    expect(updateCall).toBeDefined();
    const data = (updateCall![0] as { data: { lastRefreshedAt: Date; createdAt?: Date } }).data;
    expect(data.lastRefreshedAt).toBeInstanceOf(Date);
    expect(data.createdAt).toBeUndefined();
  });

  it("archives the new product when all variants are out of stock", async () => {
    const product = mkProduct({
      colors: [
        {
          id: "v-1",
          pfsColorRef: null,
          unitPrice: 10,
          weight: 0.1,
          stock: 0, // out of stock
          isPrimary: true,
          saleType: "UNIT",
          packQuantity: null,
          variantSizes: [{ size: { name: "M", pfsSizeRef: "M" }, quantity: 1 }],
          color: { pfsColorRef: "Noir" },
          subColors: [],
          images: [],
        },
      ],
    });
    mockProductFindUnique.mockResolvedValue(product);
    pfsCheckReferenceSpy.mockResolvedValue({
      exists: true,
      product: { id: "old_pfs_id", brand: { name: "x" }, gender: { reference: "WOMAN" }, family: { id: "fam_1" } },
    });
    pfsCreateProductSpy.mockResolvedValue({ pfsProductId: "new_pfs_id" });
    pfsCreateVariantsSpy.mockResolvedValue({ variantIds: ["new_var_1"] });
    pfsUpdateProductSpy.mockResolvedValue(undefined);
    pfsUpdateStatusSpy.mockResolvedValue(undefined);
    pfsPatchVariantsSpy.mockResolvedValue(undefined);
    mockProductUpdate.mockResolvedValue({});

    const res = await pfsRefreshProduct("p-1");

    expect(res.success).toBe(true);
    if (res.success) expect(res.archived).toBe(true);

    expect(pfsUpdateStatusSpy).toHaveBeenCalledWith([{ id: "new_pfs_id", status: "ARCHIVED" }]);

    const updateCall = mockProductUpdate.mock.calls[0] as [{ data: { status?: string; lastRefreshedAt?: Date } }];
    expect(updateCall[0].data.status).toBe("OFFLINE");
    expect(updateCall[0].data.lastRefreshedAt).toBeInstanceOf(Date);
  });

  it("rolls back when swap fails — restores old ref and marks new as DELETED", async () => {
    mockProductFindUnique.mockResolvedValue(mkProduct());
    pfsCheckReferenceSpy.mockResolvedValue({
      exists: true,
      product: { id: "old_pfs_id", brand: { name: "x" }, gender: { reference: "WOMAN" }, family: { id: "fam_1" } },
    });
    pfsCreateProductSpy.mockResolvedValue({ pfsProductId: "new_pfs_id" });
    pfsCreateVariantsSpy.mockResolvedValue({ variantIds: ["new_var_1"] });
    pfsUploadImageSpy.mockResolvedValue({ imagePath: "img_path" });

    // First call renames old to DEL (success). Second call (new → real ref) fails.
    pfsUpdateProductSpy
      .mockResolvedValueOnce(undefined) // rename old → DEL
      .mockRejectedValueOnce(new Error("PFS swap failed"));
    pfsUpdateStatusSpy.mockResolvedValue(undefined);

    const res = await pfsRefreshProduct("p-1");

    expect(res.success).toBe(false);
    if (!res.success) {
      expect(res.reason).toBe("error");
      expect(res.error).toMatch(/PFS swap failed/);
    }

    // Cleanup should restore old ref and mark new as DELETED
    const updateCalls = pfsUpdateProductSpy.mock.calls.map((c) => c[0]);
    expect(updateCalls).toContain("old_pfs_id"); // restore
    expect(updateCalls).toContain("new_pfs_id"); // rename + DELETED
  });
});
