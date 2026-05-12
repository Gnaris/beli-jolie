/**
 * Tests pour lib/ankorstore-publish.ts (mode callback-only).
 *
 * Vérifie :
 *   - ankorstoreKickoffPublish envoie le bon payload, sauve la row PENDING
 *   - le payload variant inclut wholesale/retail/originalWholesalePrice
 *   - le filtrage UNIT-only
 *   - made_in_country provient de isoCode
 *   - les prix wholesale/retail appliquent le markup
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// ─────────────────────────────────────────────
// Mocks
// ─────────────────────────────────────────────

vi.mock("@/lib/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
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

const mockCreateCatalogOperation = vi.fn().mockResolvedValue({ operationId: "op1" });
const mockAddProductsToOperation = vi.fn().mockResolvedValue({ totalProductsCount: 1 });
const mockStartOperation = vi.fn().mockResolvedValue(undefined);

vi.mock("@/lib/ankorstore-api-write", () => ({
  ankorstoreCreateCatalogOperation: (...args: unknown[]) => mockCreateCatalogOperation(...args),
  ankorstoreAddProductsToOperation: (...args: unknown[]) => mockAddProductsToOperation(...args),
  ankorstoreStartOperation: (...args: unknown[]) => mockStartOperation(...args),
  ankorstoreLookupProductIdBySku: vi.fn().mockResolvedValue("ank-1"),
}));

vi.mock("@/lib/ankorstore-api", () => ({
  ankorstoreGetVariants: vi.fn().mockResolvedValue([]),
}));

// Prisma
const mockProductFindUnique = vi.fn();
const mockAnkorstoreOperationCreate = vi.fn().mockResolvedValue({});
const mockAnkorstoreOperationUpdateMany = vi.fn().mockResolvedValue({ count: 0 });

vi.mock("@/lib/prisma", () => ({
  prisma: {
    product: { findUnique: (...args: unknown[]) => mockProductFindUnique(...args) },
    companyInfo: { findFirst: vi.fn().mockResolvedValue({ shopName: "Test Shop" }) },
    ankorstoreOperation: {
      create: (...args: unknown[]) => mockAnkorstoreOperationCreate(...args),
      updateMany: (...args: unknown[]) => mockAnkorstoreOperationUpdateMany(...args),
    },
  },
}));

// ─────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────

function makeUnitProduct(overrides: Record<string, unknown> = {}) {
  return {
    id: "p1",
    reference: "REF1",
    name: "Bague Argent",
    description: "Belle bague",
    status: "ONLINE",
    isBestSeller: false,
    primaryColorId: "c1",
    dimensionLength: null,
    dimensionWidth: null,
    dimensionHeight: null,
    dimensionDiameter: null,
    dimensionCircumference: null,
    sizeDetailsTu: null,
    category: { id: "cat1", pfsCategoryId: null, pfsGender: null, pfsFamilyId: null, pfsFamilyName: null, pfsCategoryName: null },
    colors: [
      {
        id: "v1",
        unitPrice: 10,
        weight: 0.05,
        stock: 100,
        isPrimary: true,
        saleType: "UNIT",
        packQuantity: null,
        sku: null,
        variantSizes: [{ size: { name: "M" }, quantity: 1 }],
        colorId: "c1",
        color: { id: "c1", name: "Argent" },
        packLines: [],
        images: [],
      },
    ],
    colorImages: [],
    compositions: [{ percentage: 92.5, composition: { name: "Argent 925", pfsCompositionRef: null } }],
    manufacturingCountry: { isoCode: "FR", pfsCountryRef: null },
    season: null,
    ...overrides,
  };
}

// ─────────────────────────────────────────────
// Tests
// ─────────────────────────────────────────────

describe("ankorstoreKickoffPublish — payload kickoff", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockCreateCatalogOperation.mockResolvedValue({ operationId: "op1" });
    mockAddProductsToOperation.mockResolvedValue({ totalProductsCount: 1 });
    mockStartOperation.mockResolvedValue(undefined);
    mockAnkorstoreOperationCreate.mockResolvedValue({});
    mockAnkorstoreOperationUpdateMany.mockResolvedValue({ count: 0 });
  });

  it("UNIT mono-color → kickoff réussit avec operationId, sauve la row PENDING", async () => {
    const { ankorstoreKickoffPublish } = await import("@/lib/ankorstore-publish");
    mockProductFindUnique.mockResolvedValue(makeUnitProduct());

    const result = await ankorstoreKickoffPublish("p1");
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.operationId).toBe("op1");

    expect(mockAddProductsToOperation).toHaveBeenCalledOnce();
    const [, products] = mockAddProductsToOperation.mock.calls[0];
    const product = products[0];

    expect(product.externalId).toBe("REF1");
    expect(product.variants).toHaveLength(1);
    const variant = product.variants[0];
    expect(variant.sku).toMatch(/^REF1_/);
    expect(typeof variant.wholesalePrice).toBe("number");
    expect(typeof variant.retailPrice).toBe("number");
    expect(typeof variant.originalWholesalePrice).toBe("number");
    expect(variant.options).toEqual(
      expect.arrayContaining([
        { name: "color", value: "Argent" },
        { name: "size", value: "M" },
      ]),
    );

    // Tracking row created
    expect(mockAnkorstoreOperationCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          id: "op1",
          productId: "p1",
          type: "PUBLISH",
          status: "PENDING",
        }),
      }),
    );
  });

  it("PACK only → kickoff refusé (Ankorstore ne supporte pas les packs)", async () => {
    const { ankorstoreKickoffPublish } = await import("@/lib/ankorstore-publish");
    mockProductFindUnique.mockResolvedValue(
      makeUnitProduct({
        colors: [
          {
            id: "v2",
            unitPrice: 30,
            weight: 0.15,
            stock: 50,
            isPrimary: true,
            saleType: "PACK",
            packQuantity: 3,
            sku: null,
            variantSizes: [{ size: { name: "M" }, quantity: 3 }],
            colorId: "c1",
            color: { id: "c1", name: "Blanc" },
            packLines: [],
            images: [],
          },
        ],
      }),
    );

    const result = await ankorstoreKickoffPublish("p1");
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toMatch(/à l'unité/i);
    }
    expect(mockAddProductsToOperation).not.toHaveBeenCalled();
  });

  it("made_in_country provient de manufacturingCountry.isoCode", async () => {
    const { ankorstoreKickoffPublish } = await import("@/lib/ankorstore-publish");
    mockProductFindUnique.mockResolvedValue(
      makeUnitProduct({ manufacturingCountry: { isoCode: "CN", pfsCountryRef: "Chine" } }),
    );

    const result = await ankorstoreKickoffPublish("p1");
    expect(result.success).toBe(true);

    expect(mockAddProductsToOperation).toHaveBeenCalledOnce();
    const [, products] = mockAddProductsToOperation.mock.calls[0];
    expect(products[0].countryCode).toBe("CN");
  });

  it("wholesale et retail prices avec markup appliqué", async () => {
    const { ankorstoreKickoffPublish } = await import("@/lib/ankorstore-publish");
    const { loadAnkorstorePricingConfig, getAnkorstorePackedPrice } = await import(
      "@/lib/ankorstore-pricing"
    );

    vi.mocked(loadAnkorstorePricingConfig).mockResolvedValue({
      wholesale: { type: "percent", value: 20, rounding: "none" },
      retail: { type: "percent", value: 50, rounding: "none" },
      vatRate: 20,
    });

    // 4 appels : 2 dans buildAnkorstoreVariants, 2 pour les prix produit
    vi.mocked(getAnkorstorePackedPrice)
      .mockImplementationOnce(() => 12)
      .mockImplementationOnce(() => 15)
      .mockImplementationOnce(() => 12)
      .mockImplementationOnce(() => 15);

    mockProductFindUnique.mockResolvedValue(makeUnitProduct());

    const result = await ankorstoreKickoffPublish("p1");
    expect(result.success).toBe(true);

    expect(mockAddProductsToOperation).toHaveBeenCalledOnce();
    const [, products] = mockAddProductsToOperation.mock.calls[0];
    const product = products[0];
    expect(product.wholesalePrice).toBe(12);
    expect(product.retailPrice).toBe(15);
  });

  it("rejette si addProducts renvoie totalProductsCount=0", async () => {
    const { ankorstoreKickoffPublish } = await import("@/lib/ankorstore-publish");
    mockProductFindUnique.mockResolvedValue(makeUnitProduct());
    mockAddProductsToOperation.mockResolvedValue({ totalProductsCount: 0 });

    const result = await ankorstoreKickoffPublish("p1");
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toMatch(/silencieusement rejeté/);
    }
    expect(mockAnkorstoreOperationCreate).not.toHaveBeenCalled();
  });
});
