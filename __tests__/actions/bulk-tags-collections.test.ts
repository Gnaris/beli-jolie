/**
 * Tests pour les server actions bulk du menu « Plus » :
 *  - bulkAddTagsToProducts / bulkRemoveTagsFromProducts (products.ts)
 *  - bulkAddProductsToCollection (collections.ts)
 *
 * Couvre : refus quand liste vide, cardinalité (products × tags),
 * skipDuplicates sur les liens tags, filtrage ONLINE côté collection.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// ─── Mocks Prisma communs aux 2 fichiers testés ────────────────────────────

vi.mock("@/lib/prisma", () => ({
  prisma: {
    product: { findMany: vi.fn() },
    tag: { findMany: vi.fn() },
    productTag: {
      createMany: vi.fn(),
      deleteMany: vi.fn(),
    },
    collection: { findUnique: vi.fn() },
    collectionProduct: {
      aggregate: vi.fn(),
      createMany: vi.fn(),
    },
  },
}));

vi.mock("next-auth", () => ({
  getServerSession: vi.fn().mockResolvedValue({ user: { role: "ADMIN" } }),
}));
vi.mock("@/lib/auth", () => ({ authOptions: {} }));

vi.mock("next/cache", () => ({
  revalidatePath: vi.fn(),
  revalidateTag: vi.fn(),
}));

vi.mock("@/lib/product-events", () => ({ emitProductEvent: vi.fn() }));
vi.mock("@/lib/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

// Modules tirés par products.ts / collections.ts mais non exercés ici
vi.mock("@/lib/translate", () => ({ invalidateProductTranslations: vi.fn() }));
vi.mock("@/lib/notifications", () => ({}));
vi.mock("@/lib/auto-translate", () => ({
  autoTranslateProduct: vi.fn(),
  autoTranslateTag: vi.fn(),
  autoTranslateCollection: vi.fn(),
}));
vi.mock("@/lib/sku", () => ({ generateSku: vi.fn() }));
vi.mock("@/lib/image-utils", () => ({ getImagePaths: vi.fn() }));
vi.mock("@/lib/pfs-annexes", () => ({ getPfsAnnexes: vi.fn() }));
vi.mock("@/lib/normalize-primary-flag", () => ({ normalizePrimaryFlag: vi.fn() }));
vi.mock("@/lib/variant-image-coverage", () => ({ anyVariantHasImage: vi.fn(() => true) }));
vi.mock("@/lib/product-primary-color", () => ({
  resolvePrimaryColorId: vi.fn(),
  listAvailableColorIds: vi.fn(),
}));
vi.mock("@/lib/pfs-color-conflicts", () => ({
  validateOverridesNotMatchingPrincipal: vi.fn(),
}));
vi.mock("@/lib/efashion-color-conflicts", () => ({
  validateEfashionOverridesNotMatchingPrincipal: vi.fn(),
}));
vi.mock("@/lib/microstore-subcategory", () => ({ normalizeMicrostoreSubCategoryId: vi.fn() }));
vi.mock("@/lib/product-variant-validation", () => ({
  validateVariants: vi.fn(),
  validateVariantBounds: vi.fn(),
  validateProductFields: vi.fn(),
  isMultiColorPackInput: vi.fn(() => false),
}));
vi.mock("@/lib/storage", () => ({
  deleteFiles: vi.fn(),
  keyFromDbPath: vi.fn(),
  productImageDir: vi.fn(),
  renameProductFolder: vi.fn(),
  deleteDirectory: vi.fn(),
  collectionImageDir: vi.fn(),
  renameCollectionFolder: vi.fn(),
  deleteFile: vi.fn(),
}));
vi.mock("@/lib/tenant", () => ({ requireCurrentTenant: vi.fn(async () => ({ slug: "beliandjolie" })) }));
vi.mock("@/lib/admin-action-otp", () => ({
  guardAdminActionOtp: vi.fn(),
  applyPauseChoice: vi.fn(),
}));
vi.mock("@/i18n/locales", () => ({ NON_DEFAULT_LOCALES: [] }));

import { prisma } from "@/lib/prisma";
import {
  bulkAddTagsToProducts,
  bulkRemoveTagsFromProducts,
} from "@/app/actions/admin/products";
import { bulkAddProductsToCollection } from "@/app/actions/admin/collections";

const productFindManyMock = prisma.product.findMany as unknown as ReturnType<typeof vi.fn>;
const tagFindManyMock = prisma.tag.findMany as unknown as ReturnType<typeof vi.fn>;
const productTagCreateManyMock = prisma.productTag.createMany as unknown as ReturnType<typeof vi.fn>;
const productTagDeleteManyMock = prisma.productTag.deleteMany as unknown as ReturnType<typeof vi.fn>;
const collectionFindUniqueMock = prisma.collection.findUnique as unknown as ReturnType<typeof vi.fn>;
const collectionProductAggregateMock = prisma.collectionProduct.aggregate as unknown as ReturnType<typeof vi.fn>;
const collectionProductCreateManyMock = prisma.collectionProduct.createMany as unknown as ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.clearAllMocks();
});

// ═══════════════════════════════════════════════════════════════════════════
// bulkAddTagsToProducts
// ═══════════════════════════════════════════════════════════════════════════

describe("bulkAddTagsToProducts", () => {
  it("refuse si aucun produit sélectionné", async () => {
    await expect(bulkAddTagsToProducts([], ["t1"])).rejects.toThrow(/Aucun produit/);
  });

  it("refuse si aucun tag sélectionné", async () => {
    await expect(bulkAddTagsToProducts(["p1"], [])).rejects.toThrow(/Aucun tag/);
  });

  it("refuse au-delà de 1000 produits", async () => {
    const ids = Array.from({ length: 1001 }, (_, i) => `p${i}`);
    await expect(bulkAddTagsToProducts(ids, ["t1"])).rejects.toThrow(/Maximum 1000/);
  });

  it("crée le produit cartésien produits × tags avec skipDuplicates", async () => {
    productFindManyMock.mockResolvedValueOnce([{ id: "p1" }, { id: "p2" }]);
    tagFindManyMock.mockResolvedValueOnce([{ id: "t1" }, { id: "t2" }, { id: "t3" }]);
    productTagCreateManyMock.mockResolvedValueOnce({ count: 5 }); // 6 tentés, 1 déjà présent

    const res = await bulkAddTagsToProducts(["p1", "p2"], ["t1", "t2", "t3"]);

    expect(productTagCreateManyMock).toHaveBeenCalledOnce();
    const arg = productTagCreateManyMock.mock.calls[0][0];
    expect(arg.skipDuplicates).toBe(true);
    // 2 produits × 3 tags = 6 lignes
    expect(arg.data).toHaveLength(6);
    expect(arg.data).toContainEqual({ productId: "p1", tagId: "t1" });
    expect(arg.data).toContainEqual({ productId: "p2", tagId: "t3" });

    expect(res).toEqual({
      productsCount: 2,
      tagsCount: 3,
      linksCreated: 5,
    });
  });

  it("refuse si tous les produits demandés sont introuvables", async () => {
    productFindManyMock.mockResolvedValueOnce([]);
    tagFindManyMock.mockResolvedValueOnce([{ id: "t1" }]);

    await expect(bulkAddTagsToProducts(["ghost"], ["t1"])).rejects.toThrow(/Aucun produit trouvé/);
  });

  it("refuse si tous les tags demandés sont introuvables", async () => {
    productFindManyMock.mockResolvedValueOnce([{ id: "p1" }]);
    tagFindManyMock.mockResolvedValueOnce([]);

    await expect(bulkAddTagsToProducts(["p1"], ["ghost"])).rejects.toThrow(/Aucun tag trouvé/);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// bulkRemoveTagsFromProducts
// ═══════════════════════════════════════════════════════════════════════════

describe("bulkRemoveTagsFromProducts", () => {
  it("refuse si aucun produit sélectionné", async () => {
    await expect(bulkRemoveTagsFromProducts([], ["t1"])).rejects.toThrow(/Aucun produit/);
  });

  it("refuse si aucun tag sélectionné", async () => {
    await expect(bulkRemoveTagsFromProducts(["p1"], [])).rejects.toThrow(/Aucun tag/);
  });

  it("supprime les liens correspondant à (products ∩ tags)", async () => {
    productTagDeleteManyMock.mockResolvedValueOnce({ count: 4 });

    const res = await bulkRemoveTagsFromProducts(["p1", "p2"], ["t1", "t2"]);

    expect(productTagDeleteManyMock).toHaveBeenCalledOnce();
    expect(productTagDeleteManyMock).toHaveBeenCalledWith({
      where: {
        productId: { in: ["p1", "p2"] },
        tagId: { in: ["t1", "t2"] },
      },
    });
    expect(res).toEqual({
      productsCount: 2,
      tagsCount: 2,
      linksRemoved: 4,
    });
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// bulkAddProductsToCollection
// ═══════════════════════════════════════════════════════════════════════════

describe("bulkAddProductsToCollection", () => {
  it("refuse si aucun produit sélectionné", async () => {
    await expect(bulkAddProductsToCollection("col-1", [])).rejects.toThrow(/Aucun produit/);
  });

  it("refuse si la collection n'existe plus", async () => {
    collectionFindUniqueMock.mockResolvedValueOnce(null);
    await expect(bulkAddProductsToCollection("ghost", ["p1"])).rejects.toThrow(/introuvable/);
  });

  it("ignore les produits non-ONLINE et retourne les références ignorées", async () => {
    collectionFindUniqueMock.mockResolvedValueOnce({ id: "col-1" });
    productFindManyMock.mockResolvedValueOnce([
      { id: "p1", reference: "REF-1", status: "ONLINE" },
      { id: "p2", reference: "REF-2", status: "OFFLINE" },
      { id: "p3", reference: "REF-3", status: "ARCHIVED" },
    ]);
    collectionProductAggregateMock.mockResolvedValueOnce({ _max: { position: 4 } });
    collectionProductCreateManyMock.mockResolvedValueOnce({ count: 1 });

    const res = await bulkAddProductsToCollection("col-1", ["p1", "p2", "p3"]);

    // Seul p1 (ONLINE) est envoyé au createMany
    expect(collectionProductCreateManyMock).toHaveBeenCalledOnce();
    const arg = collectionProductCreateManyMock.mock.calls[0][0];
    expect(arg.skipDuplicates).toBe(true);
    expect(arg.data).toHaveLength(1);
    expect(arg.data[0]).toEqual({
      collectionId: "col-1",
      productId: "p1",
      colorId: null,
      position: 5, // max + 1
    });

    expect(res).toEqual({
      added: 1,
      skipped: 2,
      skippedReferences: ["REF-2", "REF-3"],
    });
  });

  it("gère une collection vide (position démarre à 0)", async () => {
    collectionFindUniqueMock.mockResolvedValueOnce({ id: "col-1" });
    productFindManyMock.mockResolvedValueOnce([
      { id: "p1", reference: "REF-1", status: "ONLINE" },
      { id: "p2", reference: "REF-2", status: "ONLINE" },
    ]);
    collectionProductAggregateMock.mockResolvedValueOnce({ _max: { position: null } });
    collectionProductCreateManyMock.mockResolvedValueOnce({ count: 2 });

    const res = await bulkAddProductsToCollection("col-1", ["p1", "p2"]);

    const arg = collectionProductCreateManyMock.mock.calls[0][0];
    expect(arg.data.map((d: { position: number }) => d.position)).toEqual([0, 1]);
    expect(res.added).toBe(2);
    expect(res.skipped).toBe(0);
  });

  it("ne crée aucun lien quand tous les produits sont hors ligne", async () => {
    collectionFindUniqueMock.mockResolvedValueOnce({ id: "col-1" });
    productFindManyMock.mockResolvedValueOnce([
      { id: "p1", reference: "REF-1", status: "OFFLINE" },
    ]);

    const res = await bulkAddProductsToCollection("col-1", ["p1"]);

    expect(collectionProductCreateManyMock).not.toHaveBeenCalled();
    expect(res).toEqual({
      added: 0,
      skipped: 1,
      skippedReferences: ["REF-1"],
    });
  });
});
