import { describe, it, expect, vi, beforeEach } from "vitest";

// These modules MUST NOT be imported by app/actions/admin/products.ts anymore.
// If they are, the test's import-side-effect check at the bottom fails.

const mockProductFindUnique = vi.fn();
const mockProductFindMany = vi.fn();
const mockProductUpdate = vi.fn();
const mockProductUpdateMany = vi.fn();
const mockProductDelete = vi.fn();
const mockProductDeleteMany = vi.fn();
const mockOrderItemCount = vi.fn();
const mockOrderItemGroupBy = vi.fn();
const mockProductColorFindMany = vi.fn();
const mockProductColorImageFindMany = vi.fn();
const mockCartItemDeleteMany = vi.fn();

vi.mock("@/lib/prisma", () => ({
  prisma: {
    product: {
      findUnique: (...a: unknown[]) => mockProductFindUnique(...a),
      findMany: (...a: unknown[]) => mockProductFindMany(...a),
      update: (...a: unknown[]) => mockProductUpdate(...a),
      updateMany: (...a: unknown[]) => mockProductUpdateMany(...a),
      delete: (...a: unknown[]) => mockProductDelete(...a),
      deleteMany: (...a: unknown[]) => mockProductDeleteMany(...a),
    },
    orderItem: {
      count: (...a: unknown[]) => mockOrderItemCount(...a),
      groupBy: (...a: unknown[]) => mockOrderItemGroupBy(...a),
    },
    productColor: { findMany: (...a: unknown[]) => mockProductColorFindMany(...a) },
    productColorImage: { findMany: (...a: unknown[]) => mockProductColorImageFindMany(...a) },
    cartItem: { deleteMany: (...a: unknown[]) => mockCartItemDeleteMany(...a) },
  },
}));

vi.mock("next-auth", () => ({
  getServerSession: vi.fn().mockResolvedValue({ user: { id: "admin-1", role: "ADMIN" } }),
}));
vi.mock("@/lib/auth", () => ({ authOptions: {} }));
vi.mock("next/cache", () => ({
  revalidatePath: vi.fn(),
  revalidateTag: vi.fn(),
  unstable_cache: <T extends (...args: unknown[]) => unknown>(fn: T) => fn,
}));
vi.mock("next/navigation", () => ({ redirect: vi.fn() }));
vi.mock("@/lib/logger", () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));
vi.mock("@/lib/translate", () => ({ invalidateProductTranslations: vi.fn() }));
vi.mock("@/lib/notifications", () => ({}));
const { emitProductEventSpy } = vi.hoisted(() => ({ emitProductEventSpy: vi.fn() }));
vi.mock("@/lib/product-events", () => ({ emitProductEvent: emitProductEventSpy }));
vi.mock("@/lib/auto-translate", () => ({ autoTranslateProduct: vi.fn(), autoTranslateTag: vi.fn() }));
vi.mock("@/lib/sku", () => ({ generateSku: vi.fn() }));
vi.mock("@/lib/storage", () => ({
  deleteFiles: vi.fn(),
  keyFromDbPath: vi.fn((s: string) => s),
  productImageDir: vi.fn(() => "uploads/tid/produits/ref"),
  deleteDirectory: vi.fn(),
}));
vi.mock("@/lib/image-utils", () => ({ getImagePaths: vi.fn(() => ({ large: "l", medium: "m", thumb: "t" })) }));

// Tenant courant : évite la levée dans requireCurrentTenant sans HTTP context.
vi.mock("@/lib/tenant", () => ({
  requireCurrentTenant: vi.fn().mockResolvedValue({ id: "tid", slug: "boutique", name: "Boutique" }),
  getCurrentTenantId: vi.fn().mockResolvedValue("tid"),
  getCurrentTenantSlug: vi.fn().mockResolvedValue("boutique"),
}));

// bulkDeleteProducts appelle guardAdminActionOtp. En test on veut bypass total
// pour se concentrer sur la logique de suppression.
vi.mock("@/lib/admin-action-otp", () => ({
  guardAdminActionOtp: vi.fn().mockResolvedValue(undefined),
  applyPauseChoice: vi.fn().mockResolvedValue(undefined),
  isOtpPauseActive: vi.fn().mockResolvedValue(false),
}));

// Spy-mock the marketplace API modules so we can detect any accidental call.
const {
  pfsCheckReferenceSpy,
  pfsDeleteProductSpy,
  ankorstoreDeleteProductSpy,
  getCachedAnkorstoreEnabledSpy,
} = vi.hoisted(() => ({
  pfsCheckReferenceSpy: vi.fn(),
  pfsDeleteProductSpy: vi.fn(),
  ankorstoreDeleteProductSpy: vi.fn(),
  getCachedAnkorstoreEnabledSpy: vi.fn().mockResolvedValue(true),
}));

vi.mock("@/lib/pfs-api", () => ({ pfsCheckReference: pfsCheckReferenceSpy }));
vi.mock("@/lib/pfs-api-write", () => ({
  pfsDeleteProduct: pfsDeleteProductSpy,
  // Stubs for getPfsAnnexes() chain (loaded by products.ts → lib/pfs-annexes).
  pfsGetGenders: vi.fn().mockResolvedValue([]),
  pfsGetFamilies: vi.fn().mockResolvedValue([]),
  pfsGetCategories: vi.fn().mockResolvedValue([]),
  pfsGetColors: vi.fn().mockResolvedValue([]),
  pfsGetCompositions: vi.fn().mockResolvedValue([]),
  pfsGetCountries: vi.fn().mockResolvedValue([]),
  pfsGetSizes: vi.fn().mockResolvedValue([]),
  pfsGetCollections: vi.fn().mockResolvedValue([]),
}));
vi.mock("@/lib/ankorstore-api-write", () => ({
  ankorstoreDeleteProduct: ankorstoreDeleteProductSpy,
}));
vi.mock("@/lib/cached-data", async () => {
  const actual = await vi.importActual<Record<string, unknown>>("@/lib/cached-data");
  return {
    ...actual,
    getCachedAnkorstoreEnabled: getCachedAnkorstoreEnabledSpy,
  };
});

import { deleteProduct, bulkDeleteProducts, previewProductDeletion } from "@/app/actions/admin/products";

beforeEach(() => {
  vi.clearAllMocks();
});

describe("product deletion does not touch marketplaces", () => {
  it("deleteProduct() never calls PFS nor Ankorstore (even if ankorsProductId is set)", async () => {
    mockProductFindUnique.mockResolvedValue({ reference: "REF-1" });
    mockOrderItemCount.mockResolvedValue(0);
    mockProductColorFindMany.mockResolvedValue([]);
    mockProductColorImageFindMany.mockResolvedValue([]);
    mockProductDelete.mockResolvedValue({});

    await deleteProduct("p-1");

    expect(pfsCheckReferenceSpy).not.toHaveBeenCalled();
    expect(pfsDeleteProductSpy).not.toHaveBeenCalled();
    expect(ankorstoreDeleteProductSpy).not.toHaveBeenCalled();
    expect(mockProductDelete).toHaveBeenCalledWith({ where: { id: "p-1" } });
  });

  it("bulkDeleteProducts() never calls PFS nor Ankorstore", async () => {
    mockProductFindMany.mockResolvedValue([
      { id: "p-1", reference: "REF-1" },
      { id: "p-2", reference: "REF-2" },
    ]);
    mockOrderItemGroupBy.mockResolvedValue([]);
    mockProductColorFindMany.mockResolvedValue([]);
    mockProductColorImageFindMany.mockResolvedValue([]);
    mockProductDeleteMany.mockResolvedValue({ count: 2 });

    const result = await bulkDeleteProducts(["p-1", "p-2"]);

    expect(pfsCheckReferenceSpy).not.toHaveBeenCalled();
    expect(pfsDeleteProductSpy).not.toHaveBeenCalled();
    expect(ankorstoreDeleteProductSpy).not.toHaveBeenCalled();
    expect(result.deleted).toBe(2);
    expect(result.sold).toEqual([]);
  });
});

describe("deleteProduct — suppression toujours définitive (2026-09-18)", () => {
  it("supprime un produit jamais vendu", async () => {
    mockProductFindUnique.mockResolvedValue({ reference: "REF-NEW" });
    mockOrderItemCount.mockResolvedValue(0);
    mockProductColorFindMany.mockResolvedValue([]);
    mockProductColorImageFindMany.mockResolvedValue([]);
    mockProductDelete.mockResolvedValue({});

    const result = await deleteProduct("p-new");

    expect(result).toEqual({ action: "deleted", orderCount: 0 });
    expect(mockProductDelete).toHaveBeenCalledWith({ where: { id: "p-new" } });
    expect(mockProductUpdate).not.toHaveBeenCalled();
  });

  it("supprime AUSSI un produit déjà vendu (fallback archivage retiré)", async () => {
    mockProductFindUnique.mockResolvedValue({ reference: "REF-SOLD" });
    mockOrderItemCount.mockResolvedValue(3);
    mockProductColorFindMany.mockResolvedValue([]);
    mockProductColorImageFindMany.mockResolvedValue([]);
    mockProductDelete.mockResolvedValue({});

    const result = await deleteProduct("p-sold");

    expect(result).toEqual({ action: "deleted", orderCount: 3 });
    expect(mockProductDelete).toHaveBeenCalledWith({ where: { id: "p-sold" } });
    // Plus jamais d'update vers ARCHIVED — la fiche disparaît complètement.
    expect(mockProductUpdate).not.toHaveBeenCalled();
  });

  it("throws when the product does not exist", async () => {
    mockProductFindUnique.mockResolvedValue(null);

    await expect(deleteProduct("missing")).rejects.toThrow("Produit introuvable");
    expect(mockProductDelete).not.toHaveBeenCalled();
    expect(mockProductUpdate).not.toHaveBeenCalled();
  });
});

describe("bulkDeleteProducts — supprime tout, remonte les refs vendues pour info", () => {
  it("supprime tous les produits sélectionnés (même ceux déjà vendus) et remonte la liste des refs vendues", async () => {
    mockProductFindMany.mockResolvedValue([
      { id: "p-1", reference: "REF-1" }, // sold
      { id: "p-2", reference: "REF-2" }, // never sold
      { id: "p-3", reference: "REF-3" }, // never sold
    ]);
    mockOrderItemGroupBy.mockResolvedValue([
      { productRef: "REF-1", _count: { id: 7 } },
    ]);
    mockProductColorFindMany.mockResolvedValue([]);
    mockProductColorImageFindMany.mockResolvedValue([]);
    mockProductDeleteMany.mockResolvedValue({ count: 3 });

    const result = await bulkDeleteProducts(["p-1", "p-2", "p-3"]);

    expect(result.deleted).toBe(3);
    expect(result.sold).toEqual([
      { id: "p-1", reference: "REF-1", orderCount: 7 },
    ]);
    // Aucun updateMany (plus de fallback ARCHIVED).
    expect(mockProductUpdateMany).not.toHaveBeenCalled();
    expect(mockProductDeleteMany).toHaveBeenCalledWith({
      where: { id: { in: ["p-1", "p-2", "p-3"] } },
    });
  });

  it("supprime aussi quand tous les produits ont été vendus", async () => {
    mockProductFindMany.mockResolvedValue([
      { id: "p-1", reference: "REF-1" },
      { id: "p-2", reference: "REF-2" },
    ]);
    mockOrderItemGroupBy.mockResolvedValue([
      { productRef: "REF-1", _count: { id: 2 } },
      { productRef: "REF-2", _count: { id: 5 } },
    ]);
    mockProductColorFindMany.mockResolvedValue([]);
    mockProductColorImageFindMany.mockResolvedValue([]);
    mockProductDeleteMany.mockResolvedValue({ count: 2 });

    const result = await bulkDeleteProducts(["p-1", "p-2"]);

    expect(result.deleted).toBe(2);
    expect(result.sold).toEqual([
      { id: "p-1", reference: "REF-1", orderCount: 2 },
      { id: "p-2", reference: "REF-2", orderCount: 5 },
    ]);
    expect(mockProductUpdateMany).not.toHaveBeenCalled();
  });

  it("deletes every product when none have been ordered", async () => {
    mockProductFindMany.mockResolvedValue([
      { id: "p-1", reference: "REF-1" },
      { id: "p-2", reference: "REF-2" },
    ]);
    mockOrderItemGroupBy.mockResolvedValue([]);
    mockProductColorFindMany.mockResolvedValue([]);
    mockProductColorImageFindMany.mockResolvedValue([]);
    mockProductDeleteMany.mockResolvedValue({ count: 2 });

    const result = await bulkDeleteProducts(["p-1", "p-2"]);

    expect(result.deleted).toBe(2);
    expect(result.sold).toEqual([]);
    expect(mockProductUpdateMany).not.toHaveBeenCalled();
  });

  it("throws when no ids are provided", async () => {
    await expect(bulkDeleteProducts([])).rejects.toThrow("Aucun produit sélectionné");
  });
});

describe("previewProductDeletion — remonte willDelete + soldReferences", () => {
  it("classe TOUS les ids dans willDelete et met à part les refs vendues", async () => {
    mockProductFindMany.mockResolvedValue([
      { id: "p-1", reference: "REF-1" }, // sold
      { id: "p-2", reference: "REF-2" }, // never sold
      { id: "p-3", reference: "REF-3" }, // sold
    ]);
    mockOrderItemGroupBy.mockResolvedValue([
      { productRef: "REF-1", _count: { id: 4 } },
      { productRef: "REF-3", _count: { id: 1 } },
    ]);

    const result = await previewProductDeletion(["p-1", "p-2", "p-3"]);

    expect(result.willDelete).toEqual([
      { id: "p-1", reference: "REF-1", orderCount: 4 },
      { id: "p-2", reference: "REF-2", orderCount: 0 },
      { id: "p-3", reference: "REF-3", orderCount: 1 },
    ]);
    expect(result.soldReferences).toEqual([
      { id: "p-1", reference: "REF-1", orderCount: 4 },
      { id: "p-3", reference: "REF-3", orderCount: 1 },
    ]);
  });

  it("returns empty result when ids list is empty (no DB call)", async () => {
    const result = await previewProductDeletion([]);
    expect(result).toEqual({ willDelete: [], soldReferences: [] });
    expect(mockProductFindMany).not.toHaveBeenCalled();
  });

  it("soldReferences vide quand aucun produit vendu", async () => {
    mockProductFindMany.mockResolvedValue([
      { id: "p-1", reference: "REF-1" },
      { id: "p-2", reference: "REF-2" },
    ]);
    mockOrderItemGroupBy.mockResolvedValue([]);

    const result = await previewProductDeletion(["p-1", "p-2"]);

    expect(result.soldReferences).toEqual([]);
    expect(result.willDelete).toEqual([
      { id: "p-1", reference: "REF-1", orderCount: 0 },
      { id: "p-2", reference: "REF-2", orderCount: 0 },
    ]);
  });
});
