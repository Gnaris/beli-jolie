/**
 * Tests for lib/ankorstore-update.ts
 *
 * Covers:
 * 1. Snapshot identical → no API calls (returns success immediately)
 * 2. Only stock changes → only ankorstorePatchVariantStock + ankorstorePatchVariantPrices called
 * 3. forceFullSync → ignores prevSnapshot, sends everything
 * 4. No ankorsProductId → returns error without API calls
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  ANKORSTORE_SNAPSHOT_VERSION,
  type AnkorstoreSyncSnapshot,
} from "@/lib/ankorstore-sync-diff";

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

const mockPatchVariantStock = vi.fn().mockResolvedValue(undefined);
const mockPatchVariantPrices = vi.fn().mockResolvedValue(undefined);
const mockCreateCatalogOperation = vi.fn().mockResolvedValue({ operationId: "op-test" });
const mockAddProductsToOperation = vi.fn().mockResolvedValue(undefined);
const mockStartOperation = vi.fn().mockResolvedValue(undefined);
const mockPollOperation = vi.fn().mockResolvedValue({
  status: "succeeded",
  results: [
    {
      externalProductId: "REF001",
      ankorstoreProductId: "ank-1",
      status: "success",
      failureReason: null,
      issues: [],
    },
  ],
});

vi.mock("@/lib/ankorstore-api-write", () => ({
  ankorstorePatchVariantStock: (...args: unknown[]) => mockPatchVariantStock(...args),
  ankorstorePatchVariantPrices: (...args: unknown[]) => mockPatchVariantPrices(...args),
  ankorstoreCreateCatalogOperation: (...args: unknown[]) => mockCreateCatalogOperation(...args),
  ankorstoreAddProductsToOperation: (...args: unknown[]) => mockAddProductsToOperation(...args),
  ankorstoreStartOperation: (...args: unknown[]) => mockStartOperation(...args),
  ankorstorePollOperation: (...args: unknown[]) => mockPollOperation(...args),
  ankorstoreDeleteProduct: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("@/lib/ankorstore-api", () => ({
  ankorstoreGetVariants: vi.fn().mockResolvedValue([]),
  ankorstoreFindVariantBySku: vi.fn().mockResolvedValue(null),
}));

vi.mock("@/lib/ankorstore-pricing", () => ({
  loadAnkorstorePricingConfig: vi.fn().mockResolvedValue({
    wholesale: { type: "percent", value: 0, rounding: "none" },
    retail: { type: "percent", value: 0, rounding: "none" },
    vatRate: 20,
  }),
  getAnkorstorePackedPrice: vi.fn().mockImplementation((total: number) => total),
  toCents: (eur: number) => Math.round(eur * 100),
}));

vi.mock("@/lib/ankorstore-description", () => ({
  formatAnkorstoreDescription: vi.fn().mockImplementation(
    (input: { description: string; reference: string }) =>
      `${input.description}\n\nRéférence : ${input.reference}`,
  ),
}));

// ─────────────────────────────────────────────
// Prisma mock
// ─────────────────────────────────────────────

const mockProductUpdate = vi.fn().mockResolvedValue({});

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
      update: vi.fn().mockResolvedValue({}),
    },
    $transaction: vi.fn().mockResolvedValue([]),
  },
}));

// ─────────────────────────────────────────────
// Test helpers
// ─────────────────────────────────────────────

import { prisma } from "@/lib/prisma";

/** A minimal valid snapshot with one variant and one image.
 *  IMPORTANT: description must match what formatAnkorstoreDescription (mocked) produces.
 *  Images key must match what buildImagesSnapshot produces: "main" + slot "1".
 */
function makeSnapshot(overrides?: Partial<AnkorstoreSyncSnapshot>): AnkorstoreSyncSnapshot {
  return {
    schemaVersion: ANKORSTORE_SNAPSHOT_VERSION,
    product: {
      externalId: "REF001",
      name: "Test Product",
      description: FORMATTED_DESC,
      vatRate: 20,
      countryCode: "FR",
      unitMultiplier: 1,
      brandName: "Test Boutique",
    },
    variants: {
      "ank-variant-1": {
        sku: "REF001_red_UNIT_1",
        // getAnkorstorePackedPrice mock returns the raw total (10 EUR) for both wholesale and retail
        // toCents(10) = 1000
        wholesalePriceCents: 1000,
        retailPriceCents: 1000,
        stockQty: 10,
        isAlwaysInStock: false,
        optionColor: "Rouge",
        optionSize: "TU",
      },
    },
    images: {
      main: { "1": "/uploads/produits/ref001/ref001-red-1.webp" },
    },
    status: "active",
    ...overrides,
  };
}

// The formatted description that formatAnkorstoreDescription will produce for this product:
// formatAnkorstoreDescription is mocked as: `${description}\n\nRéférence : ${reference}`
// So for name="Test Product", description="Test description", reference="REF001":
//   result = "Test description\n\nRéférence : REF001"
const FORMATTED_DESC = "Test description\n\nRéférence : REF001";

/** A minimal valid product returned by Prisma findUnique. */
function makeProduct(overrides?: Record<string, unknown>) {
  return {
    id: "product-1",
    reference: "REF001",
    name: "Test Product",
    description: "Test description",
    status: "ONLINE",
    isBestSeller: false,
    primaryColorId: "color-1",
    ankorsProductId: "ank-product-1",
    ankorsLastSyncSnapshot: null,
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
        ankorsVariantId: "ank-variant-1",
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

// ─────────────────────────────────────────────
// Tests
// ─────────────────────────────────────────────

describe("ankorstoreUpdateProductInPlace", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Re-apply default mocks after clearAllMocks
    mockPatchVariantStock.mockResolvedValue(undefined);
    mockPatchVariantPrices.mockResolvedValue(undefined);
    mockCreateCatalogOperation.mockResolvedValue({ operationId: "op-test" });
    mockAddProductsToOperation.mockResolvedValue(undefined);
    mockStartOperation.mockResolvedValue(undefined);
    mockPollOperation.mockResolvedValue({
      status: "succeeded",
      results: [
        {
          externalProductId: "REF001",
          ankorstoreProductId: "ank-1",
          status: "success",
          failureReason: null,
          issues: [],
        },
      ],
    });
    mockProductUpdate.mockResolvedValue({});
    vi.mocked(prisma.companyInfo.findFirst).mockResolvedValue({ shopName: "Test Boutique" } as never);
  });

  it("Test 1: snapshot identique → aucun appel API, retourne success", async () => {
    // Build a snapshot that exactly matches the product state
    const prevSnapshot = makeSnapshot();
    const product = makeProduct({ ankorsLastSyncSnapshot: prevSnapshot });
    vi.mocked(prisma.product.findUnique).mockResolvedValue(product as never);

    const { ankorstoreUpdateProductInPlace } = await import("@/lib/ankorstore-update");

    const result = await ankorstoreUpdateProductInPlace("product-1");

    expect(result).toEqual({ success: true, archived: false });

    // No catalog operation
    expect(mockCreateCatalogOperation).not.toHaveBeenCalled();
    // No variant patches
    expect(mockPatchVariantStock).not.toHaveBeenCalled();
    expect(mockPatchVariantPrices).not.toHaveBeenCalled();
  });

  it("Test 2: seul le stock change → seul ankorstorePatchVariantStock appelé (pas le catalogue)", async () => {
    // Prev snapshot has stock=10, but product now has stock=5.
    // makeSnapshot() uses the mocked formatted description and correct image key.
    const prevSnapshot = makeSnapshot();
    // Product with same prices but different stock
    const product = makeProduct({
      ankorsLastSyncSnapshot: prevSnapshot,
      colors: [
        {
          id: "variant-1",
          ankorsVariantId: "ank-variant-1",
          unitPrice: 10,
          weight: 0.5,
          stock: 5, // Changed from 10 to 5
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
    });
    vi.mocked(prisma.product.findUnique).mockResolvedValue(product as never);

    const { ankorstoreUpdateProductInPlace } = await import("@/lib/ankorstore-update");
    const result = await ankorstoreUpdateProductInPlace("product-1");

    expect(result).toEqual({ success: true, archived: false });

    // Only stock/price patches — NO catalog update operation
    expect(mockCreateCatalogOperation).not.toHaveBeenCalled();
    expect(mockPatchVariantStock).toHaveBeenCalledWith("ank-variant-1", {
      stockQuantity: 5,
      isAlwaysInStock: false,
    });
    // Both wholesale and retail use the same mock (getAnkorstorePackedPrice returns raw total)
    // so toCents(10) = 1000 for both
    expect(mockPatchVariantPrices).toHaveBeenCalledWith("ank-variant-1", {
      wholesalePriceCents: 1000,
      retailPriceCents: 1000,
    });

    // Only the one variant was patched
    expect(mockPatchVariantStock).toHaveBeenCalledTimes(1);
  });

  it("Test 3: forceFullSync → ignore prevSnapshot, envoie tout", async () => {
    // Identical snapshot (would normally short-circuit)
    const prevSnapshot = makeSnapshot();
    const product = makeProduct({ ankorsLastSyncSnapshot: prevSnapshot });
    vi.mocked(prisma.product.findUnique).mockResolvedValue(product as never);

    const { ankorstoreUpdateProductInPlace } = await import("@/lib/ankorstore-update");
    const result = await ankorstoreUpdateProductInPlace("product-1", undefined, {
      forceFullSync: true,
    });

    expect(result).toEqual({ success: true, archived: false });

    // With forceFullSync, prevSnapshot is treated as null → full diff → productChanged = true
    // → catalog operation is triggered
    expect(mockCreateCatalogOperation).toHaveBeenCalledWith("update");
    expect(mockAddProductsToOperation).toHaveBeenCalled();
    expect(mockStartOperation).toHaveBeenCalled();
    expect(mockPollOperation).toHaveBeenCalled();

    // Variant is also treated as changed (all variants in next.variants)
    expect(mockPatchVariantStock).toHaveBeenCalled();
    expect(mockPatchVariantPrices).toHaveBeenCalled();
  });

  it("Test 4: pas de ankorsProductId → retourne error sans appel API", async () => {
    const product = makeProduct({ ankorsProductId: null });
    vi.mocked(prisma.product.findUnique).mockResolvedValue(product as never);

    const { ankorstoreUpdateProductInPlace } = await import("@/lib/ankorstore-update");
    const result = await ankorstoreUpdateProductInPlace("product-1");

    expect(result).toEqual({
      success: false,
      error: "Produit non publié sur Ankorstore (pas de ankorsProductId)",
    });

    expect(mockCreateCatalogOperation).not.toHaveBeenCalled();
    expect(mockPatchVariantStock).not.toHaveBeenCalled();
    expect(mockPatchVariantPrices).not.toHaveBeenCalled();
  });

  it("Bonus: produit introuvable en base → retourne error", async () => {
    vi.mocked(prisma.product.findUnique).mockResolvedValue(null);

    const { ankorstoreUpdateProductInPlace } = await import("@/lib/ankorstore-update");
    const result = await ankorstoreUpdateProductInPlace("missing-product");

    expect(result).toEqual({ success: false, error: "Produit introuvable en base" });
    expect(mockCreateCatalogOperation).not.toHaveBeenCalled();
  });

  it("Bonus: mise à jour du snapshot sauvegardée en BDD après sync réussie", async () => {
    // prevSnapshot has old name — product has "Test Product" (different) → productChanged = true
    const prevSnapshot = makeSnapshot({
      product: {
        externalId: "REF001",
        name: "Old Name", // Will differ from product.name="Test Product"
        description: FORMATTED_DESC,
        vatRate: 20,
        countryCode: "FR",
        unitMultiplier: 1,
        brandName: "Test Boutique",
      },
    });
    const product = makeProduct({
      ankorsLastSyncSnapshot: prevSnapshot,
    });
    vi.mocked(prisma.product.findUnique).mockResolvedValue(product as never);

    const { ankorstoreUpdateProductInPlace } = await import("@/lib/ankorstore-update");
    await ankorstoreUpdateProductInPlace("product-1");

    // Snapshot should be saved to DB
    expect(mockProductUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "product-1" },
        data: expect.objectContaining({
          ankorsLastSyncSnapshot: expect.objectContaining({
            schemaVersion: ANKORSTORE_SNAPSHOT_VERSION,
          }),
        }),
      }),
    );
  });
});
