import { describe, it, expect, vi, beforeEach } from "vitest";

const {
  mockFindUnique,
  mockCompanyFindFirst,
  mockProductUpdate,
  pfsTranslateSpy,
  pfsUpdateProductSpy,
  pfsGetCategoriesSpy,
  pfsGetFamiliesSpy,
  pfsGetColorsSpy,
  pfsGetVariantsSpy,
  pfsCheckReferenceSpy,
  pfsCreateVariantsSpy,
  pfsPatchVariantsSpy,
  pfsDeleteVariantSpy,
  pfsUploadImageSpy,
  pfsDeleteImageSpy,
  pfsUpdateStatusSpy,
  pfsRemoveStarSpy,
  loadMarkupSpy,
  storageReadFileSpy,
  sharpInstanceMock,
} = vi.hoisted(() => {
  const sharpJpeg = vi.fn().mockReturnThis();
  const sharpToBuffer = vi.fn().mockResolvedValue(Buffer.from("jpg"));
  const sharpInstanceMock = { jpeg: sharpJpeg, toBuffer: sharpToBuffer };
  return {
    mockFindUnique: vi.fn(),
    mockCompanyFindFirst: vi.fn().mockResolvedValue({ shopName: "MaBoutique" }),
    mockProductUpdate: vi.fn().mockResolvedValue({}),
    pfsTranslateSpy: vi.fn().mockResolvedValue({ en: "n", de: "n", es: "n", it: "n" }),
    pfsUpdateProductSpy: vi.fn().mockResolvedValue({}),
    pfsGetCategoriesSpy: vi.fn().mockResolvedValue([]),
    pfsGetFamiliesSpy: vi.fn().mockResolvedValue([]),
    pfsGetColorsSpy: vi.fn().mockResolvedValue([]),
    pfsGetVariantsSpy: vi.fn().mockResolvedValue([]),
    pfsCheckReferenceSpy: vi.fn().mockResolvedValue({ exists: true, product: { images: {} } }),
    pfsCreateVariantsSpy: vi.fn().mockResolvedValue([]),
    pfsPatchVariantsSpy: vi.fn().mockResolvedValue({}),
    pfsDeleteVariantSpy: vi.fn().mockResolvedValue({}),
    pfsUploadImageSpy: vi.fn().mockResolvedValue({}),
    pfsDeleteImageSpy: vi.fn().mockResolvedValue({}),
    pfsUpdateStatusSpy: vi.fn().mockResolvedValue({}),
    pfsRemoveStarSpy: vi.fn().mockResolvedValue({}),
    loadMarkupSpy: vi.fn().mockResolvedValue({ pfs: undefined }),
    storageReadFileSpy: vi.fn().mockResolvedValue(Buffer.from("img")),
    sharpInstanceMock,
  };
});

vi.mock("@/lib/prisma", () => ({
  prisma: {
    product: {
      findUnique: (...a: unknown[]) => mockFindUnique(...a),
      update: (...a: unknown[]) => mockProductUpdate(...a),
    },
    companyInfo: {
      findFirst: (...a: unknown[]) => mockCompanyFindFirst(...a),
    },
    siteConfig: {
      findFirst: vi.fn().mockResolvedValue(null),
      findUnique: vi.fn().mockResolvedValue(null),
    },
  },
}));
vi.mock("@/lib/pfs-api-write", () => ({
  pfsTranslate: pfsTranslateSpy,
  pfsUpdateProduct: pfsUpdateProductSpy,
  pfsGetCategories: pfsGetCategoriesSpy,
  pfsGetFamilies: pfsGetFamiliesSpy,
  pfsGetColors: pfsGetColorsSpy,
  pfsCreateVariants: pfsCreateVariantsSpy,
  pfsPatchVariants: pfsPatchVariantsSpy,
  pfsDeleteVariant: pfsDeleteVariantSpy,
  pfsUploadImage: pfsUploadImageSpy,
  pfsDeleteImage: pfsDeleteImageSpy,
  pfsUpdateStatus: pfsUpdateStatusSpy,
  pfsRemoveStar: pfsRemoveStarSpy,
}));
vi.mock("@/lib/pfs-api", () => ({
  pfsGetVariants: pfsGetVariantsSpy,
  pfsCheckReference: pfsCheckReferenceSpy,
}));
vi.mock("@/lib/marketplace-pricing", () => ({
  loadMarketplaceMarkupConfigs: loadMarkupSpy,
  applyMarketplaceMarkup: (price: number) => price,
}));
vi.mock("@/lib/storage", () => ({
  readFile: storageReadFileSpy,
  keyFromDbPath: (p: string) => p,
}));
vi.mock("sharp", () => ({
  default: () => sharpInstanceMock,
}));
vi.mock("@/lib/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));
vi.mock("@/lib/product-events", () => ({ emitProductEvent: vi.fn() }));
vi.mock("next/cache", () => ({
  revalidateTag: vi.fn(),
  unstable_cache: <T extends (...args: unknown[]) => unknown>(fn: T) => fn,
}));
vi.mock("@/lib/pfs-brand", () => ({
  requirePfsBrand: vi.fn().mockResolvedValue({ id: "BRAND-1", name: "Beli & Jolie" }),
  PfsBrandRequiredError: class PfsBrandRequiredError extends Error {},
}));

import { pfsUpdateProductInPlace } from "@/lib/pfs-update";

beforeEach(() => {
  vi.clearAllMocks();
  mockCompanyFindFirst.mockResolvedValue({ shopName: "MaBoutique" });
});

function buildProductRow(snapshot: unknown) {
  return {
    id: "p-1",
    reference: "REF-1",
    name: "Mon produit",
    description: "Desc",
    status: "ONLINE",
    primaryColorId: "col-1",
    pfsProductId: "PFS-1",
    pfsLastSyncSnapshot: snapshot,
    isBestSeller: false,
    dimensionLength: null,
    dimensionWidth: null,
    dimensionHeight: null,
    dimensionDiameter: null,
    dimensionCircumference: null,
    sizeDetailsTu: null,
    category: {
      id: "c-1",
      pfsCategoryId: "PFS-CAT",
      pfsGender: "WOMAN",
      pfsFamilyId: "PFS-FAM",
      pfsFamilyName: "Famille",
      pfsCategoryName: "Cat",
    },
    colors: [
      {
        id: "v-1",
        pfsVariantId: "PFS-V1",
        unitPrice: 10,
        weight: 1000,
        stock: 5,
        isPrimary: true,
        saleType: "UNIT",
        packQuantity: null,
        variantSizes: [{ size: { name: "M", pfsSizeRef: "M" }, quantity: 5 }],
        colorId: "col-1",
        color: { id: "col-1", name: "Rouge", pfsColorRef: "RED" },
        packLines: [],
        images: [],
      },
    ],
    // Une image par couleur — sinon `filterVariantsWithImages` (cf.
    // lib/pfs-update.ts) exclut toutes les variantes du test.
    colorImages: [{ path: "/mock/v-1.jpg", order: 0, colorId: "col-1" }],
    compositions: [],
    countryIsoCode: "FR",
    season: null,
  };
}

describe("pfsUpdateProductInPlace forceFullSync", () => {
  it("sans forceFullSync : si le snapshot DB est identique à l'état cible, pfsUpdateProduct n'est pas rappelé", async () => {
    mockFindUnique.mockResolvedValueOnce(buildProductRow(null));
    await pfsUpdateProductInPlace("p-1");
    const savedSnapshot = mockProductUpdate.mock.calls[0][0].data.pfsLastSyncSnapshot;
    pfsUpdateProductSpy.mockClear();

    mockFindUnique.mockResolvedValueOnce(buildProductRow(savedSnapshot));
    const res = await pfsUpdateProductInPlace("p-1");

    expect(res.success).toBe(true);
    expect(pfsUpdateProductSpy).not.toHaveBeenCalled();
  });

  it("avec forceFullSync=true : pfsUpdateProduct est appelé même si le snapshot est identique", async () => {
    mockFindUnique.mockResolvedValueOnce(buildProductRow(null));
    await pfsUpdateProductInPlace("p-1");
    const savedSnapshot = mockProductUpdate.mock.calls[0][0].data.pfsLastSyncSnapshot;
    pfsUpdateProductSpy.mockClear();

    mockFindUnique.mockResolvedValueOnce(buildProductRow(savedSnapshot));
    const res = await pfsUpdateProductInPlace("p-1", undefined, { forceFullSync: true });

    expect(res.success).toBe(true);
    expect(pfsUpdateProductSpy).toHaveBeenCalled();
  });

  it("avec forceFullSync=true : efface chaque image existante sur PFS (slot + couleur) avant de ré-uploader", async () => {
    // PFS renvoie 2 images existantes pour la couleur RED (slot 1 + slot 2).
    pfsCheckReferenceSpy.mockResolvedValueOnce({
      exists: true,
      product: {
        images: {
          RED: ["https://pfs.cdn/red-1.jpg", "https://pfs.cdn/red-2.jpg"],
          DEFAULT: "https://pfs.cdn/default.jpg",
        },
      },
    });
    mockFindUnique.mockResolvedValueOnce(buildProductRow(null));

    const res = await pfsUpdateProductInPlace("p-1", undefined, { forceFullSync: true });

    expect(res.success).toBe(true);
    // 2 suppressions sur RED (slot 1 et slot 2). DEFAULT est ignoré.
    const wipeCalls = pfsDeleteImageSpy.mock.calls.filter(([, , colorRef]) => colorRef === "RED");
    expect(wipeCalls).toHaveLength(2);
    expect(wipeCalls).toEqual(
      expect.arrayContaining([
        ["PFS-1", 1, "RED"],
        ["PFS-1", 2, "RED"],
      ]),
    );
    expect(pfsDeleteImageSpy).not.toHaveBeenCalledWith("PFS-1", expect.anything(), "DEFAULT");
  });

  it("sans forceFullSync : ne fetch pas l'état PFS et n'efface rien (diff seul)", async () => {
    mockFindUnique.mockResolvedValueOnce(buildProductRow(null));

    await pfsUpdateProductInPlace("p-1");

    expect(pfsCheckReferenceSpy).not.toHaveBeenCalled();
  });

  it("avec forceFullSync=true et un crash mi-sync : le snapshot DB préserve l'état connu précédent", async () => {
    // 1re sync pour capturer un snapshot DB sain.
    mockFindUnique.mockResolvedValueOnce(buildProductRow(null));
    await pfsUpdateProductInPlace("p-1");
    const savedSnapshot = mockProductUpdate.mock.calls[0][0].data.pfsLastSyncSnapshot;
    mockProductUpdate.mockClear();

    // 2e sync forcée mais qui crashe sur la mise à jour produit.
    pfsUpdateProductSpy.mockRejectedValueOnce(new Error("PFS down"));
    mockFindUnique.mockResolvedValueOnce(buildProductRow(savedSnapshot));

    const res = await pfsUpdateProductInPlace("p-1", undefined, { forceFullSync: true });

    expect(res.success).toBe(false);

    // Le snapshot persisté ne doit PAS être réduit au fallback vide :
    // il doit refléter le savedSnapshot précédent (au moins schemaVersion + variants connus).
    if (mockProductUpdate.mock.calls.length > 0) {
      const persisted = mockProductUpdate.mock.calls[0][0].data.pfsLastSyncSnapshot;
      expect(persisted).toBeTruthy();
      expect(persisted.variants).toEqual(savedSnapshot.variants);
    }
  });
});
