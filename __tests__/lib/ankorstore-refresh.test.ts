/**
 * Tests for lib/ankorstore-refresh.ts
 *
 * Covers:
 * 1. Success path: old product archived/renamed, new created, IDs saved, snapshot reset, lastRefreshedAt set.
 * 2. ankorsProductId doesn't exist on Ankorstore → returns not_found.
 * 3. No local ankorsProductId → returns not_found.
 * 4. Failure during create new product → rollback (old product restored).
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// ─────────────────────────────────────────────
// Mocks
// ─────────────────────────────────────────────

vi.mock("@/lib/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

vi.mock("next/cache", () => ({
  revalidateTag: vi.fn(),
}));

vi.mock("@/lib/product-events", () => ({
  emitProductEvent: vi.fn(),
}));

vi.mock("@/lib/ankorstore-description", () => ({
  formatAnkorstoreDescription: vi.fn().mockImplementation(
    (input: { description: string; reference: string }) =>
      `${input.description}\n\nRéférence : ${input.reference}`,
  ),
}));

vi.mock("@/lib/ankorstore-pricing", () => ({
  loadAnkorstorePricingConfig: vi.fn().mockResolvedValue({
    wholesale: { type: "percent", value: 0, rounding: "none" },
    retail: { type: "percent", value: 0, rounding: "none" },
    vatRate: 20,
  }),
  getAnkorstorePackedPrice: vi.fn().mockImplementation((total: number) => total),
}));

// ─────────────────────────────────────────────
// Ankorstore API mocks
// ─────────────────────────────────────────────

const mockGetProduct = vi.fn();
const mockGetVariants = vi.fn().mockResolvedValue([]);

vi.mock("@/lib/ankorstore-api", () => ({
  ankorstoreGetProduct: (...args: unknown[]) => mockGetProduct(...args),
  ankorstoreGetVariants: (...args: unknown[]) => mockGetVariants(...args),
}));

const mockCreateCatalogOperation = vi.fn();
const mockAddProductsToOperation = vi.fn().mockResolvedValue(undefined);
const mockStartOperation = vi.fn().mockResolvedValue(undefined);
const mockPollOperation = vi.fn();
const mockDeleteProduct = vi.fn().mockResolvedValue(undefined);

vi.mock("@/lib/ankorstore-api-write", () => ({
  ankorstoreCreateCatalogOperation: (...args: unknown[]) => mockCreateCatalogOperation(...args),
  ankorstoreAddProductsToOperation: (...args: unknown[]) => mockAddProductsToOperation(...args),
  ankorstoreStartOperation: (...args: unknown[]) => mockStartOperation(...args),
  ankorstorePollOperation: (...args: unknown[]) => mockPollOperation(...args),
  ankorstoreDeleteProduct: (...args: unknown[]) => mockDeleteProduct(...args),
}));

// ─────────────────────────────────────────────
// Prisma mock
// ─────────────────────────────────────────────

const mockProductUpdate = vi.fn().mockResolvedValue({});
const mockProductColorUpdate = vi.fn().mockResolvedValue({});

vi.mock("@/lib/prisma", () => ({
  prisma: {
    product: {
      findUnique: vi.fn(),
      update: (...args: unknown[]) => mockProductUpdate(...args),
    },
    companyInfo: {
      findFirst: vi.fn().mockResolvedValue({ shopName: "Test Boutique" }),
    },
    productColor: {
      update: (...args: unknown[]) => mockProductColorUpdate(...args),
    },
    $transaction: vi.fn().mockImplementation(async (ops: unknown[]) => {
      if (Array.isArray(ops)) {
        for (const op of ops) {
          if (op && typeof (op as Promise<unknown>).then === "function") {
            await op;
          }
        }
      }
      return [];
    }),
  },
}));

// ─────────────────────────────────────────────
// Test helpers
// ─────────────────────────────────────────────

import { prisma } from "@/lib/prisma";
import { Prisma } from "@prisma/client";

function makeProduct(overrides?: Record<string, unknown>) {
  return {
    id: "product-1",
    reference: "REF001",
    name: "Test Product",
    description: "Test description",
    status: "ONLINE",
    isBestSeller: false,
    primaryColorId: "color-1",
    ankorsProductId: "ank-product-old",
    dimensionLength: null,
    dimensionWidth: null,
    dimensionHeight: null,
    dimensionDiameter: null,
    dimensionCircumference: null,
    sizeDetailsTu: null,
    category: {
      id: "cat-1",
      pfsCategoryId: null,
      pfsGender: null,
      pfsFamilyId: null,
      pfsFamilyName: null,
      pfsCategoryName: null,
    },
    colors: [
      {
        id: "variant-1",
        ankorsVariantId: "ank-variant-old",
        unitPrice: 10,
        weight: 0.5,
        stock: 10,
        isPrimary: true,
        saleType: "UNIT",
        packQuantity: null,
        sku: "REF001_red_UNIT_1",
        variantSizes: [],
        colorId: "color-1",
        color: { id: "color-1", name: "Rouge" },
        packLines: [],
        images: [],
      },
    ],
    colorImages: [
      {
        path: "/uploads/produits/ref001/ref001-red-1.webp",
        order: 1,
        colorId: "color-1",
      },
    ],
    compositions: [],
    manufacturingCountry: { isoCode: "FR", pfsCountryRef: null },
    season: null,
    ...overrides,
  };
}

function makeAnkorstoreProduct() {
  return {
    id: "ank-product-old",
    name: "Test Product",
    description: "Test description",
    retailPrice: 3000,
    wholesalePrice: 1500,
    vatRate: 20,
    active: true,
    archived: false,
    images: [],
    variants: [],
  };
}

/** Default poll result for "succeeded" archive operation */
function makeArchiveSuccessResult() {
  return {
    status: "succeeded" as const,
    results: [],
  };
}

/** Default poll result for "succeeded" import operation */
function makeImportSuccessResult(externalId = "REF001", ankorstoreProductId = "ank-product-new") {
  return {
    status: "succeeded" as const,
    results: [
      {
        externalProductId: externalId,
        ankorstoreProductId,
        status: "success" as const,
        failureReason: null,
        issues: [],
      },
    ],
  };
}

// ─────────────────────────────────────────────
// Tests
// ─────────────────────────────────────────────

describe("ankorstoreRefreshProduct", () => {
  beforeEach(() => {
    vi.clearAllMocks();

    // Reset all mocks to defaults
    mockProductUpdate.mockResolvedValue({});
    mockProductColorUpdate.mockResolvedValue({});
    mockDeleteProduct.mockResolvedValue(undefined);
    mockAddProductsToOperation.mockResolvedValue(undefined);
    mockStartOperation.mockResolvedValue(undefined);
    mockGetVariants.mockResolvedValue([]);

    // Default: two operations (archive + import), each gets a unique operationId
    let callCount = 0;
    mockCreateCatalogOperation.mockImplementation(() => {
      callCount++;
      return Promise.resolve({ operationId: `op-${callCount}` });
    });

    // Default poll: archive succeeds, then import succeeds
    let pollCount = 0;
    mockPollOperation.mockImplementation(() => {
      pollCount++;
      if (pollCount === 1) return Promise.resolve(makeArchiveSuccessResult());
      return Promise.resolve(makeImportSuccessResult());
    });

    vi.mocked(prisma.companyInfo.findFirst).mockResolvedValue({ shopName: "Test Boutique" } as never);

    // Fix $transaction mock to call the ops properly
    vi.mocked(prisma.$transaction).mockImplementation(async (ops: unknown) => {
      if (Array.isArray(ops)) {
        const results = [];
        for (const op of ops) {
          if (op && typeof (op as Promise<unknown>).then === "function") {
            results.push(await (op as Promise<unknown>));
          } else {
            results.push(op);
          }
        }
        return results;
      }
      return [];
    });
  });

  it("Test 1: succès — ancien archivé, nouveau créé, IDs sauvegardés, snapshot reset, lastRefreshedAt set", async () => {
    vi.mocked(prisma.product.findUnique).mockResolvedValue(makeProduct() as never);
    mockGetProduct.mockResolvedValue(makeAnkorstoreProduct());
    mockGetVariants.mockResolvedValue([
      { id: "ank-variant-new", sku: "REF001_red_UNIT_1", ian: null, name: "Rouge", retailPrice: 3000, wholesalePrice: 1500, availableQuantity: 10, stockQuantity: 10, isAlwaysInStock: false },
    ]);

    const { ankorstoreRefreshProduct } = await import("@/lib/ankorstore-refresh");
    const result = await ankorstoreRefreshProduct("product-1", undefined, { skipRevalidation: true });

    expect(result).toEqual({ success: true, newAnkorsProductId: "ank-product-new", archived: false });

    // Should create 2 operations: archive (update) and new (import)
    expect(mockCreateCatalogOperation).toHaveBeenCalledTimes(2);
    expect(mockCreateCatalogOperation).toHaveBeenNthCalledWith(1, "update");
    expect(mockCreateCatalogOperation).toHaveBeenNthCalledWith(2, "import");

    // The DB transaction must save the new ankorsProductId, reset snapshot, set lastRefreshedAt
    expect(prisma.$transaction).toHaveBeenCalled();
    expect(mockProductUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "product-1" },
        data: expect.objectContaining({
          ankorsProductId: "ank-product-new",
          ankorsLastSyncSnapshot: Prisma.DbNull,
          lastRefreshedAt: expect.any(Date),
        }),
      }),
    );

    // Variant ID should be updated
    expect(mockProductColorUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "variant-1" },
        data: { ankorsVariantId: "ank-variant-new" },
      }),
    );
  });

  it("Test 2: ankorsProductId existe localement mais produit introuvable sur Ankorstore → not_found", async () => {
    vi.mocked(prisma.product.findUnique).mockResolvedValue(makeProduct() as never);
    mockGetProduct.mockResolvedValue(null); // Product not found on Ankorstore

    const { ankorstoreRefreshProduct } = await import("@/lib/ankorstore-refresh");
    const result = await ankorstoreRefreshProduct("product-1");

    expect(result).toEqual({
      success: false,
      reason: "not_found",
      error: "Produit Ankorstore introuvable",
    });

    // No catalog operations should be attempted
    expect(mockCreateCatalogOperation).not.toHaveBeenCalled();
  });

  it("Test 3: pas de ankorsProductId local → not_found sans appel API", async () => {
    vi.mocked(prisma.product.findUnique).mockResolvedValue(
      makeProduct({ ankorsProductId: null }) as never,
    );

    const { ankorstoreRefreshProduct } = await import("@/lib/ankorstore-refresh");
    const result = await ankorstoreRefreshProduct("product-1");

    expect(result).toEqual({
      success: false,
      reason: "not_found",
      error: "Produit non publié sur Ankorstore",
    });

    // No API calls at all
    expect(mockGetProduct).not.toHaveBeenCalled();
    expect(mockCreateCatalogOperation).not.toHaveBeenCalled();
  });

  it("Test 4: échec lors de la création du nouveau produit → rollback (ancien produit restauré)", async () => {
    vi.mocked(prisma.product.findUnique).mockResolvedValue(makeProduct() as never);
    mockGetProduct.mockResolvedValue(makeAnkorstoreProduct());

    // Archive succeeds, then import fails
    let pollCount = 0;
    mockPollOperation.mockImplementation(() => {
      pollCount++;
      if (pollCount === 1) return Promise.resolve(makeArchiveSuccessResult()); // archive OK
      // Import fails
      return Promise.resolve({
        status: "failed" as const,
        results: [
          {
            externalProductId: "REF001",
            ankorstoreProductId: null,
            status: "failure" as const,
            failureReason: "Duplicate external_id",
            issues: [],
          },
        ],
      });
    });

    const { ankorstoreRefreshProduct } = await import("@/lib/ankorstore-refresh");
    const result = await ankorstoreRefreshProduct("product-1");

    expect(result).toEqual({
      success: false,
      reason: "error",
      error: expect.stringContaining("Duplicate external_id"),
    });

    // Rollback: should attempt to restore old product via a new update operation
    // Total operations: archive (op-1) + import attempt (op-2) + restore (op-3)
    expect(mockCreateCatalogOperation).toHaveBeenCalledTimes(3);

    // Last call should be a restore "update" operation with original external_id
    expect(mockCreateCatalogOperation).toHaveBeenNthCalledWith(3, "update");

    // The add call for the restore operation should use the original reference as externalId
    const addCalls = vi.mocked(mockAddProductsToOperation).mock.calls;
    const lastAddCall = addCalls[addCalls.length - 1];
    expect(lastAddCall[1][0]).toMatchObject({ externalId: "REF001" });

    // DB should NOT be updated (no new product saved)
    expect(mockProductUpdate).not.toHaveBeenCalled();
    expect(mockProductColorUpdate).not.toHaveBeenCalled();
  });

  it("Bonus: produit introuvable en base → retourne error sans appel API", async () => {
    vi.mocked(prisma.product.findUnique).mockResolvedValue(null);

    const { ankorstoreRefreshProduct } = await import("@/lib/ankorstore-refresh");
    const result = await ankorstoreRefreshProduct("missing-product");

    expect(result).toEqual({ success: false, reason: "error", error: "Produit introuvable en base" });
    expect(mockGetProduct).not.toHaveBeenCalled();
  });

  it("Bonus: si le nouveau produit est créé mais la récupération des variantes échoue → rollback avec suppression", async () => {
    vi.mocked(prisma.product.findUnique).mockResolvedValue(makeProduct() as never);
    mockGetProduct.mockResolvedValue(makeAnkorstoreProduct());

    // Archive succeeds, import succeeds, but getVariants throws
    let pollCount = 0;
    mockPollOperation.mockImplementation(() => {
      pollCount++;
      if (pollCount === 1) return Promise.resolve(makeArchiveSuccessResult());
      return Promise.resolve(makeImportSuccessResult());
    });
    mockGetVariants.mockRejectedValue(new Error("Network error getting variants"));

    const { ankorstoreRefreshProduct } = await import("@/lib/ankorstore-refresh");
    const result = await ankorstoreRefreshProduct("product-1");

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.reason).toBe("error");
    }

    // New product should be deleted (rollback)
    expect(mockDeleteProduct).toHaveBeenCalledWith("ank-product-new");

    // Old product should be restored (rollback)
    expect(mockCreateCatalogOperation).toHaveBeenCalledWith("update");

    // DB should NOT have been updated with new ID
    expect(mockProductUpdate).not.toHaveBeenCalled();
  });
});
