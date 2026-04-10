/**
 * Tests for Ankorstore sync logic:
 * - pushProductToAnkorstoreInternal (auto-detect import/update, auto-link)
 * - pushSingleProductToAnkorstore (requires admin wrapper)
 * - triggerAnkorstoreSync in products.ts (fire-and-forget)
 */
import { describe, it, expect, beforeEach, vi } from "vitest";

// ─── Mocks ────────────────────────────────────────────────────────────────────

vi.mock("next-auth", () => ({
  getServerSession: vi.fn(),
}));

vi.mock("next/cache", () => ({
  revalidateTag: vi.fn(),
}));

vi.mock("@/lib/auth", () => ({
  authOptions: {},
}));

const mockPrisma = {
  product: {
    findUnique: vi.fn(),
    update: vi.fn(),
  },
};
vi.mock("@/lib/prisma", () => ({
  prisma: mockPrisma,
}));

vi.mock("@/lib/logger", () => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

const mockAnkorstorePushProducts = vi.fn();
vi.mock("@/lib/ankorstore-api-write", () => ({
  ankorstorePushProducts: mockAnkorstorePushProducts,
  ankorstoreUpdateVariantStock: vi.fn(),
}));

vi.mock("@/lib/ankorstore-api", () => ({
  ankorstoreSearchVariants: vi.fn(),
}));

const mockLoadMarkupConfigs = vi.fn().mockResolvedValue({
  ankorstoreWholesale: null,
  ankorstoreRetail: null,
  pfsMarkup: null,
});
const mockApplyMarkup = vi.fn((price: number) => price);
vi.mock("@/lib/marketplace-pricing", () => ({
  loadMarketplaceMarkupConfigs: () => mockLoadMarkupConfigs(),
  applyMarketplaceMarkup: (price: number, _cfg: unknown) => mockApplyMarkup(price, _cfg),
}));

// ─── Test data ────────────────────────────────────────────────────────────────

const PRODUCT_ID = "test-product-123";

function makeProduct(overrides: Record<string, unknown> = {}) {
  return {
    id: PRODUCT_ID,
    name: "Foulard Soie",
    reference: "FS-001",
    description: "Un beau foulard en soie naturelle, doux et élégant.",
    ankorsProductId: null,
    manufacturingCountry: { isoCode: "FR" },
    compositions: [
      { composition: { name: "Soie" }, percentage: 100 },
    ],
    colors: [
      {
        id: "color-1",
        saleType: "UNIT",
        stock: 10,
        unitPrice: 25.0,
        packQuantity: null,
        color: { name: "Rouge" },
        images: [{ path: "/uploads/products/foulard-rouge.webp" }],
      },
    ],
    ...overrides,
  };
}

function makeSuccessResult() {
  return {
    success: true,
    results: [{ status: "success" }],
  };
}

function makeFailureResult(failureReason = "Invalid product") {
  return {
    success: true,
    results: [{ status: "failure", failureReason, issues: null }],
  };
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("pushProductToAnkorstoreInternal", () => {
  let pushProductToAnkorstoreInternal: typeof import("@/app/actions/admin/ankorstore").pushProductToAnkorstoreInternal;

  beforeEach(async () => {
    vi.resetModules();

    // Re-apply mocks after resetModules
    vi.doMock("next-auth", () => ({ getServerSession: vi.fn() }));
    vi.doMock("next/cache", () => ({ revalidateTag: vi.fn() }));
    vi.doMock("@/lib/auth", () => ({ authOptions: {} }));
    vi.doMock("@/lib/prisma", () => ({ prisma: mockPrisma }));
    vi.doMock("@/lib/logger", () => ({
      logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
    }));
    vi.doMock("@/lib/ankorstore-api-write", () => ({
      ankorstorePushProducts: mockAnkorstorePushProducts,
      ankorstoreUpdateVariantStock: vi.fn(),
    }));
    vi.doMock("@/lib/ankorstore-api", () => ({
      ankorstoreSearchVariants: vi.fn(),
    }));
    vi.doMock("@/lib/marketplace-pricing", () => ({
      loadMarketplaceMarkupConfigs: () => mockLoadMarkupConfigs(),
      applyMarketplaceMarkup: (price: number, _cfg: unknown) => mockApplyMarkup(price, _cfg),
    }));

    mockPrisma.product.findUnique.mockReset();
    mockPrisma.product.update.mockReset();
    mockAnkorstorePushProducts.mockReset();
    mockApplyMarkup.mockImplementation((price: number) => price);

    const mod = await import("@/app/actions/admin/ankorstore");
    pushProductToAnkorstoreInternal = mod.pushProductToAnkorstoreInternal;
  });

  it("returns error when product not found", async () => {
    mockPrisma.product.findUnique.mockResolvedValue(null);

    const result = await pushProductToAnkorstoreInternal(PRODUCT_ID);

    expect(result.success).toBe(false);
    expect(result.error).toContain("introuvable");
  });

  it("uses 'import' operation when ankorsProductId is null (new product)", async () => {
    mockPrisma.product.findUnique.mockResolvedValue(makeProduct());
    mockAnkorstorePushProducts.mockResolvedValue(makeSuccessResult());
    mockPrisma.product.update.mockResolvedValue({});

    const result = await pushProductToAnkorstoreInternal(PRODUCT_ID);

    expect(result.success).toBe(true);
    // Should call with "import" since ankorsProductId is null
    expect(mockAnkorstorePushProducts).toHaveBeenCalledWith(
      expect.any(Array),
      "import"
    );
  });

  it("uses 'update' operation when ankorsProductId exists (linked product)", async () => {
    mockPrisma.product.findUnique.mockResolvedValue(
      makeProduct({ ankorsProductId: "FS-001" })
    );
    mockAnkorstorePushProducts.mockResolvedValue(makeSuccessResult());

    const result = await pushProductToAnkorstoreInternal(PRODUCT_ID);

    expect(result.success).toBe(true);
    expect(mockAnkorstorePushProducts).toHaveBeenCalledWith(
      expect.any(Array),
      "update"
    );
  });

  it("optimistically links product before push (sets ankorsProductId)", async () => {
    mockPrisma.product.findUnique.mockResolvedValue(makeProduct());
    mockAnkorstorePushProducts.mockResolvedValue(makeSuccessResult());
    mockPrisma.product.update.mockResolvedValue({});

    await pushProductToAnkorstoreInternal(PRODUCT_ID);

    // First update: optimistic link (before push)
    expect(mockPrisma.product.update).toHaveBeenCalledWith({
      where: { id: PRODUCT_ID },
      data: {
        ankorsProductId: "FS-001",
        ankorsMatchedAt: expect.any(Date),
      },
    });
    // Only called once (no rollback on success)
    expect(mockPrisma.product.update).toHaveBeenCalledTimes(1);
  });

  it("does NOT re-link if already linked", async () => {
    mockPrisma.product.findUnique.mockResolvedValue(
      makeProduct({ ankorsProductId: "FS-001" })
    );
    mockAnkorstorePushProducts.mockResolvedValue(makeSuccessResult());

    await pushProductToAnkorstoreInternal(PRODUCT_ID);

    expect(mockPrisma.product.update).not.toHaveBeenCalled();
  });

  it("rolls back optimistic link when push API fails", async () => {
    mockPrisma.product.findUnique.mockResolvedValue(makeProduct());
    mockPrisma.product.update.mockResolvedValue({});
    mockAnkorstorePushProducts.mockResolvedValue({
      success: false,
      error: "API unreachable",
      results: [],
    });

    const result = await pushProductToAnkorstoreInternal(PRODUCT_ID);

    expect(result.success).toBe(false);
    expect(result.error).toContain("API unreachable");
    // Called twice: optimistic link + rollback
    expect(mockPrisma.product.update).toHaveBeenCalledTimes(2);
    expect(mockPrisma.product.update).toHaveBeenLastCalledWith({
      where: { id: PRODUCT_ID },
      data: { ankorsProductId: null, ankorsMatchedAt: null },
    });
  });

  it("rolls back optimistic link when product result has failure status", async () => {
    mockPrisma.product.findUnique.mockResolvedValue(makeProduct());
    mockPrisma.product.update.mockResolvedValue({});
    mockAnkorstorePushProducts.mockResolvedValue(makeFailureResult("Missing barcode"));

    const result = await pushProductToAnkorstoreInternal(PRODUCT_ID);

    expect(result.success).toBe(false);
    expect(result.error).toContain("Missing barcode");
    // Called twice: optimistic link + rollback
    expect(mockPrisma.product.update).toHaveBeenCalledTimes(2);
    expect(mockPrisma.product.update).toHaveBeenLastCalledWith({
      where: { id: PRODUCT_ID },
      data: { ankorsProductId: null, ankorsMatchedAt: null },
    });
  });

  it("returns error when product has no variants to push", async () => {
    mockPrisma.product.findUnique.mockResolvedValue(
      makeProduct({ colors: [] })
    );

    const result = await pushProductToAnkorstoreInternal(PRODUCT_ID);

    expect(result.success).toBe(false);
    expect(result.error).toContain("variante");
  });

  it("builds correct variant SKU and options", async () => {
    mockPrisma.product.findUnique.mockResolvedValue(makeProduct());
    mockAnkorstorePushProducts.mockResolvedValue(makeSuccessResult());
    mockPrisma.product.update.mockResolvedValue({});

    await pushProductToAnkorstoreInternal(PRODUCT_ID);

    const pushCall = mockAnkorstorePushProducts.mock.calls[0];
    const products = pushCall[0];
    const variants = products[0].variants;

    expect(variants).toHaveLength(1);
    expect(variants[0].sku).toBe("FS-001_Rouge");
    expect(variants[0].options).toEqual([
      { name: "color", value: "Rouge" },
      { name: "size", value: "Unite" },
    ]);
  });

  it("includes both UNIT and PACK variants for the same color", async () => {
    const product = makeProduct({
      colors: [
        {
          id: "color-unit",
          saleType: "UNIT",
          stock: 10,
          unitPrice: 25.0,
          packQuantity: null,
          color: { name: "Bleu" },
          images: [{ path: "/uploads/products/foulard-bleu.webp" }],
        },
        {
          id: "color-pack",
          saleType: "PACK",
          stock: 5,
          unitPrice: 0,
          packQuantity: 12,
          color: { name: "Bleu" },
          images: [],
        },
      ],
    });
    mockPrisma.product.findUnique.mockResolvedValue(product);
    mockAnkorstorePushProducts.mockResolvedValue(makeSuccessResult());
    mockPrisma.product.update.mockResolvedValue({});

    await pushProductToAnkorstoreInternal(PRODUCT_ID);

    const variants = mockAnkorstorePushProducts.mock.calls[0][0][0].variants;
    expect(variants).toHaveLength(2);
    expect(variants[0].sku).toBe("FS-001_Bleu");
    expect(variants[1].sku).toBe("FS-001_Bleu_Pack12");
    expect(variants[1].options).toEqual([
      { name: "color", value: "Bleu" },
      { name: "size", value: "Pack x12" },
    ]);
  });

  it("applies marketplace markup to prices", async () => {
    mockApplyMarkup.mockImplementation((price: number) => price * 1.2);
    mockPrisma.product.findUnique.mockResolvedValue(makeProduct());
    mockAnkorstorePushProducts.mockResolvedValue(makeSuccessResult());
    mockPrisma.product.update.mockResolvedValue({});

    await pushProductToAnkorstoreInternal(PRODUCT_ID);

    // applyMarketplaceMarkup should have been called for variant prices
    expect(mockApplyMarkup).toHaveBeenCalled();
    const variants = mockAnkorstorePushProducts.mock.calls[0][0][0].variants;
    expect(variants[0].wholesalePrice).toBe(30); // 25 * 1.2
  });
});

describe("pushSingleProductToAnkorstore (admin wrapper)", () => {
  let pushSingleProductToAnkorstore: typeof import("@/app/actions/admin/ankorstore").pushSingleProductToAnkorstore;
  const mockGetServerSession = vi.fn();

  beforeEach(async () => {
    vi.resetModules();

    vi.doMock("next-auth", () => ({ getServerSession: mockGetServerSession }));
    vi.doMock("next/cache", () => ({ revalidateTag: vi.fn() }));
    vi.doMock("@/lib/auth", () => ({ authOptions: {} }));
    vi.doMock("@/lib/prisma", () => ({ prisma: mockPrisma }));
    vi.doMock("@/lib/logger", () => ({
      logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
    }));
    vi.doMock("@/lib/ankorstore-api-write", () => ({
      ankorstorePushProducts: mockAnkorstorePushProducts,
      ankorstoreUpdateVariantStock: vi.fn(),
    }));
    vi.doMock("@/lib/ankorstore-api", () => ({
      ankorstoreSearchVariants: vi.fn(),
    }));
    vi.doMock("@/lib/marketplace-pricing", () => ({
      loadMarketplaceMarkupConfigs: () => mockLoadMarkupConfigs(),
      applyMarketplaceMarkup: (price: number, _cfg: unknown) => mockApplyMarkup(price, _cfg),
    }));

    mockGetServerSession.mockReset();
    mockPrisma.product.findUnique.mockReset();
    mockPrisma.product.update.mockReset();
    mockAnkorstorePushProducts.mockReset();
    mockApplyMarkup.mockImplementation((price: number) => price);

    const mod = await import("@/app/actions/admin/ankorstore");
    pushSingleProductToAnkorstore = mod.pushSingleProductToAnkorstore;
  });

  it("throws when user is not admin", async () => {
    mockGetServerSession.mockResolvedValue({ user: { role: "CLIENT" } });

    await expect(pushSingleProductToAnkorstore(PRODUCT_ID)).rejects.toThrow("Non autorisé");
  });

  it("delegates to internal function when admin", async () => {
    mockGetServerSession.mockResolvedValue({ user: { role: "ADMIN" } });
    mockPrisma.product.findUnique.mockResolvedValue(makeProduct());
    mockAnkorstorePushProducts.mockResolvedValue(makeSuccessResult());
    mockPrisma.product.update.mockResolvedValue({});

    const result = await pushSingleProductToAnkorstore(PRODUCT_ID);

    expect(result.success).toBe(true);
    expect(mockAnkorstorePushProducts).toHaveBeenCalled();
  });
});
