/**
 * Anti-régression : la liste `material_composition` envoyée à PFS doit
 * refléter EXACTEMENT les compositions locales mappées. Jamais injecter
 * de fallback hardcodé "ACIERINOXYDABLE" côté publish / refresh / update
 * — c'était un reliquat de l'époque "bijouterie" qui polluait les fiches
 * PFS d'Issyma (et toute autre boutique vêtements).
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const {
  mockProductFindUnique,
  mockProductUpdate,
  pfsCreateProductSpy,
  pfsUpdateProductSpy,
  pfsCreateVariantsSpy,
  pfsUploadImageSpy,
  pfsUpdateStatusSpy,
  pfsTranslateSpy,
  requirePfsBrandSpy,
} = vi.hoisted(() => ({
  mockProductFindUnique: vi.fn(),
  mockProductUpdate: vi.fn().mockResolvedValue({}),
  pfsCreateProductSpy: vi.fn().mockResolvedValue({ pfsProductId: "new_pfs_id" }),
  pfsUpdateProductSpy: vi.fn().mockResolvedValue(undefined),
  pfsCreateVariantsSpy: vi.fn().mockResolvedValue({ variantIds: ["new_var_1"] }),
  pfsUploadImageSpy: vi.fn().mockResolvedValue({ imagePath: "path" }),
  pfsUpdateStatusSpy: vi.fn().mockResolvedValue(undefined),
  pfsTranslateSpy: vi.fn().mockResolvedValue({
    productName: { fr: "Produit" },
    productDescription: { fr: "Desc" },
  }),
  requirePfsBrandSpy: vi.fn().mockResolvedValue({ id: "BRAND-1", name: "Beli & Jolie" }),
}));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    product: {
      findUnique: (...a: unknown[]) => mockProductFindUnique(...a),
      update: (...a: unknown[]) => mockProductUpdate(...a),
    },
    productColor: { update: vi.fn().mockResolvedValue({}) },
    companyInfo: { findFirst: vi.fn().mockResolvedValue({ shopName: "X" }) },
    siteConfig: {
      findFirst: vi.fn().mockResolvedValue(null),
      findUnique: vi.fn().mockResolvedValue(null),
    },
    $transaction: vi.fn(async (operations: unknown[]) => operations),
  },
}));

vi.mock("@/lib/pfs-api-write", () => ({
  pfsCreateProduct: pfsCreateProductSpy,
  pfsUpdateProduct: pfsUpdateProductSpy,
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
vi.mock("@/lib/logger", () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));
vi.mock("@/lib/product-events", () => ({ emitProductEvent: vi.fn() }));
vi.mock("@/lib/product-primary-color", () => ({
  getProductPrimaryColorId: vi.fn(() => "color-1"),
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

function mkProduct(compositions: Array<{ percentage: number; composition: { pfsCompositionRef: string | null } }>) {
  return {
    id: "p-1",
    reference: "REF-1",
    name: "Pantalon ballon",
    description: "Pantalon similicuir gaufré.",
    status: "ONLINE",
    isBestSeller: false,
    primaryColorId: "color-1",
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
      pfsFamilyName: "Vêtements",
      pfsCategoryName: "Pantalons",
    },
    colors: [
      {
        id: "v-1",
        unitPrice: 10,
        weight: 0.3,
        stock: 5,
        isPrimary: true,
        saleType: "UNIT",
        packQuantity: null,
        variantSizes: [{ size: { name: "M", pfsSizeRef: "M" }, quantity: 1 }],
        colorId: "color-1",
        color: { id: "color-1", name: "Brun foncé", pfsColorRef: null },
        packLines: [],
        images: [{ path: "/uploads/products/a.webp", order: 0, colorId: "color-1" }],
      },
    ],
    colorImages: [{ path: "/uploads/products/a.webp", order: 0, colorId: "color-1" }],
    compositions,
    countryIsoCode: "CN",
    season: { pfsRef: "PE2026" },
    pfsBrandId: null,
    pfsBrandName: null,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("pfsPublishProduct — composition sans fallback acier inoxydable", () => {
  it("n'injecte PAS ACIERINOXYDABLE quand toutes les compos locales ont un pfsCompositionRef", async () => {
    mockProductFindUnique.mockResolvedValue(
      mkProduct([
        { percentage: 50, composition: { pfsCompositionRef: "POLYESTER" } },
        { percentage: 50, composition: { pfsCompositionRef: "PU" } },
      ]),
    );

    await pfsPublishProduct("p-1");

    const payload = pfsCreateProductSpy.mock.calls[0][0] as {
      material_composition: { id: string }[];
    };
    expect(payload.material_composition.map((c) => c.id)).toEqual(["POLYESTER", "PU"]);
    expect(payload.material_composition.find((c) => c.id === "ACIERINOXYDABLE")).toBeUndefined();
  });

  it("n'injecte PAS ACIERINOXYDABLE quand toutes les compos locales n'ont pas de pfsCompositionRef", async () => {
    mockProductFindUnique.mockResolvedValue(
      mkProduct([
        { percentage: 100, composition: { pfsCompositionRef: null } },
      ]),
    );

    await pfsPublishProduct("p-1");

    const payload = pfsCreateProductSpy.mock.calls[0][0] as {
      material_composition: { id: string }[];
    };
    expect(payload.material_composition).toEqual([]);
  });

  it("filtre uniquement les compos sans pfsCompositionRef, pas d'ajout acier", async () => {
    mockProductFindUnique.mockResolvedValue(
      mkProduct([
        { percentage: 70, composition: { pfsCompositionRef: "VISCOSE" } },
        { percentage: 30, composition: { pfsCompositionRef: null } },
      ]),
    );

    await pfsPublishProduct("p-1");

    const payload = pfsCreateProductSpy.mock.calls[0][0] as {
      material_composition: { id: string }[];
    };
    expect(payload.material_composition.map((c) => c.id)).toEqual(["VISCOSE"]);
    expect(payload.material_composition.find((c) => c.id === "ACIERINOXYDABLE")).toBeUndefined();
  });
});
