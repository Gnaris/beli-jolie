/**
 * Tests pour lib/ankorstore-refresh.ts (mode callback-only, 2 phases).
 *
 * Couvre :
 *   1. Kickoff réussi : ancien existe + SKU récupérés + delete kickoff + row PENDING type=REFRESH_DELETE_OLD
 *   2. ankorsProductId existe localement mais produit introuvable sur Ankorstore → not_found
 *   3. Pas de ankorsProductId local → not_found
 *   4. Pas de SKUs côté Ankorstore → error
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

vi.mock("next/cache", () => ({
  revalidateTag: vi.fn(),
  unstable_cache: <T extends (...args: never[]) => unknown>(fn: T) => fn,
}));
vi.mock("@/lib/product-events", () => ({ emitProductEvent: vi.fn() }));

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
  getAnkorstoreChainedRetailPrice: vi.fn().mockImplementation((total: number) => total),
}));

const mockGetProduct = vi.fn();
const mockGetVariants = vi.fn().mockResolvedValue([]);

vi.mock("@/lib/ankorstore-api", () => ({
  ankorstoreGetProduct: (...args: unknown[]) => mockGetProduct(...args),
  ankorstoreGetVariants: (...args: unknown[]) => mockGetVariants(...args),
}));

const mockKickoffDelete = vi.fn().mockResolvedValue({ operationId: "op-delete" });

vi.mock("@/lib/ankorstore-api-write", () => ({
  ankorstoreKickoffDelete: (...args: unknown[]) => mockKickoffDelete(...args),
  ankorstoreCreateCatalogOperation: vi.fn().mockResolvedValue({ operationId: "op-create" }),
  ankorstoreAddProductsToOperation: vi.fn().mockResolvedValue({ totalProductsCount: 1 }),
  ankorstoreStartOperation: vi.fn().mockResolvedValue(undefined),
  ankorstoreLookupProductIdBySku: vi.fn().mockResolvedValue("ank-new"),
}));

const mockProductFindUnique = vi.fn();
const mockAnkorstoreOperationCreate = vi.fn().mockResolvedValue({});
const mockAnkorstoreOperationUpdateMany = vi.fn().mockResolvedValue({ count: 0 });

vi.mock("@/lib/prisma", () => ({
  prisma: {
    product: {
      findUnique: (...args: unknown[]) => mockProductFindUnique(...args),
      update: vi.fn().mockResolvedValue({}),
    },
    companyInfo: {
      findFirst: vi.fn().mockResolvedValue({ shopName: "Test Boutique" }),
    },
    productColor: {
      update: vi.fn().mockResolvedValue({}),
      updateMany: vi.fn().mockResolvedValue({ count: 0 }),
    },
    ankorstoreOperation: {
      create: (...args: unknown[]) => mockAnkorstoreOperationCreate(...args),
      updateMany: (...args: unknown[]) => mockAnkorstoreOperationUpdateMany(...args),
    },
    $transaction: vi.fn().mockResolvedValue([]),
  },
}));

function makeProductLite(overrides?: Record<string, unknown>) {
  return {
    id: "product-1",
    reference: "REF001",
    ankorsProductId: "ank-old",
    ...overrides,
  };
}

function makeProductFull(overrides?: Record<string, unknown>) {
  return {
    id: "product-1",
    reference: "REF001",
    name: "Test Product",
    description: "Test description",
    status: "ONLINE",
    primaryColorId: "color-1",
    dimensionLength: null,
    dimensionWidth: null,
    dimensionHeight: null,
    dimensionDiameter: null,
    dimensionCircumference: null,
    sizeDetailsTu: null,
    category: { id: "cat-1", pfsCategoryId: null, pfsGender: null, pfsFamilyId: null, pfsFamilyName: null, pfsCategoryName: null },
    colors: [
      {
        id: "variant-1",
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
      { path: "/uploads/produits/ref001/ref001-red-1.webp", order: 1, colorId: "color-1" },
    ],
    compositions: [],
    manufacturingCountry: { isoCode: "FR", pfsCountryRef: null },
    season: null,
    ...overrides,
  };
}

function makeAnkorstoreProduct() {
  return {
    id: "ank-old",
    externalId: "REF001",
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

describe("ankorstoreKickoffRefresh (callback-only, phase 1: delete old)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockKickoffDelete.mockResolvedValue({ operationId: "op-delete" });
    mockAnkorstoreOperationCreate.mockResolvedValue({});
    mockAnkorstoreOperationUpdateMany.mockResolvedValue({ count: 0 });
  });

  it("Test 1: succès — kickoff delete envoyé, row PENDING type=REFRESH_DELETE_OLD créée", async () => {
    // findUnique est appelé 2 fois : 1 fois pour la version lite (ankorsProductId), 1 fois pour la version full
    mockProductFindUnique
      .mockResolvedValueOnce(makeProductLite())
      .mockResolvedValueOnce(makeProductFull());
    mockGetProduct.mockResolvedValue(makeAnkorstoreProduct());
    mockGetVariants.mockResolvedValue([
      { id: "ank-v-old", sku: "REF001_red_UNIT_1", ian: null, name: "Rouge", retailPrice: 3000, wholesalePrice: 1500, availableQuantity: 10, stockQuantity: 10, isAlwaysInStock: false },
    ]);

    const { ankorstoreKickoffRefresh } = await import("@/lib/ankorstore-refresh");
    const result = await ankorstoreKickoffRefresh("product-1");

    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.operationId).toBe("op-delete");

    // Kickoff delete avec externalId + SKU list
    expect(mockKickoffDelete).toHaveBeenCalledWith("REF001", ["REF001_red_UNIT_1"]);

    // Row PENDING type=REFRESH_DELETE_OLD
    expect(mockAnkorstoreOperationCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          id: "op-delete",
          type: "REFRESH_DELETE_OLD",
          status: "PENDING",
        }),
      }),
    );
  });

  it("Test 2: ankorsProductId existe localement mais produit introuvable sur Ankorstore → not_found", async () => {
    mockProductFindUnique.mockResolvedValueOnce(makeProductLite());
    mockGetProduct.mockResolvedValue(null);

    const { ankorstoreKickoffRefresh } = await import("@/lib/ankorstore-refresh");
    const result = await ankorstoreKickoffRefresh("product-1");

    expect(result).toEqual({
      success: false,
      reason: "not_found",
      error: "Produit Ankorstore introuvable",
    });

    expect(mockKickoffDelete).not.toHaveBeenCalled();
  });

  it("Test 3: pas de ankorsProductId local → not_found", async () => {
    mockProductFindUnique.mockResolvedValueOnce(makeProductLite({ ankorsProductId: null }));

    const { ankorstoreKickoffRefresh } = await import("@/lib/ankorstore-refresh");
    const result = await ankorstoreKickoffRefresh("product-1");

    expect(result).toEqual({
      success: false,
      reason: "not_found",
      error: "Produit non publié sur Ankorstore",
    });
    expect(mockGetProduct).not.toHaveBeenCalled();
    expect(mockKickoffDelete).not.toHaveBeenCalled();
  });

  it("Test 4: pas de SKUs côté Ankorstore → error", async () => {
    mockProductFindUnique.mockResolvedValueOnce(makeProductLite());
    mockGetProduct.mockResolvedValue(makeAnkorstoreProduct());
    mockGetVariants.mockResolvedValue([]); // aucune variante avec SKU

    const { ankorstoreKickoffRefresh } = await import("@/lib/ankorstore-refresh");
    const result = await ankorstoreKickoffRefresh("product-1");

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.reason).toBe("error");
      expect(result.error).toMatch(/SKU/);
    }
    expect(mockKickoffDelete).not.toHaveBeenCalled();
  });

  it("Bonus: produit introuvable en base → error sans appel API", async () => {
    mockProductFindUnique.mockResolvedValueOnce(null);

    const { ankorstoreKickoffRefresh } = await import("@/lib/ankorstore-refresh");
    const result = await ankorstoreKickoffRefresh("missing-product");

    expect(result).toEqual({ success: false, reason: "error", error: "Produit introuvable en base" });
    expect(mockGetProduct).not.toHaveBeenCalled();
  });
});
