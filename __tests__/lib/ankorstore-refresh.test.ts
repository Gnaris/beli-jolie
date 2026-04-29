import { describe, it, expect, vi, beforeEach } from "vitest";

const {
  ankorstoreSearchProductsByRefSpy,
  ankorstorePushProductsSpy,
  loadExportProductsSpy,
  loadExportContextSpy,
} = vi.hoisted(() => ({
  ankorstoreSearchProductsByRefSpy: vi.fn(),
  ankorstorePushProductsSpy: vi.fn(),
  loadExportProductsSpy: vi.fn(),
  loadExportContextSpy: vi.fn(),
}));

vi.mock("@/lib/ankorstore-api", () => ({
  ankorstoreSearchProductsByRef: ankorstoreSearchProductsByRefSpy,
}));
vi.mock("@/lib/ankorstore-api-write", () => ({
  ankorstorePushProducts: ankorstorePushProductsSpy,
}));
vi.mock("@/lib/marketplace-excel/load-products", () => ({
  loadExportProducts: loadExportProductsSpy,
  loadExportContext: loadExportContextSpy,
}));
vi.mock("@/lib/marketplace-pricing", () => ({
  applyMarketplaceMarkup: vi.fn((price: number) => price),
  loadMarketplaceMarkupConfigs: vi.fn().mockResolvedValue({
    pfs: undefined,
    ankorstoreWholesale: undefined,
    ankorstoreRetail: undefined,
  }),
}));
vi.mock("@/lib/logger", () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));

import { ankorstoreRefreshProduct } from "@/lib/ankorstore-refresh";

function mkExportProduct(overrides: Record<string, unknown> = {}) {
  return {
    id: "p-1",
    reference: "REF-1",
    name: "Collier",
    description: "Description longue dépassant trente caractères facilement.",
    pfsGenderCode: "WOMAN",
    pfsFamilyName: null,
    pfsCategoryName: null,
    categoryName: "Colliers",
    seasonPfsRef: null,
    manufacturingCountryName: "Chine",
    manufacturingCountryIso: "CN",
    compositions: [{ name: "Acier", percentage: 100 }],
    translations: {},
    variants: [
      {
        variantId: "v-1",
        saleType: "UNIT" as const,
        colorNames: ["Noir"],
        packQuantity: null,
        sizes: [{ name: "TU", quantity: 1, pfsSizeRef: "TU" }],
        unitPrice: 10,
        weight: 0.05,
        stock: 10,
        sku: "REF-1_NOIR_UNIT_1",
        imagePaths: ["/uploads/products/a.webp"],
      },
    ],
    ...overrides,
  };
}

const defaultCtx = {
  shopName: "Ma Boutique",
  markups: { pfs: undefined, ankorstoreWholesale: undefined, ankorstoreRetail: undefined },
  ankorstoreVatRate: 20,
  publicBaseUrl: "https://pub.example.com",
};

beforeEach(() => {
  vi.clearAllMocks();
  loadExportContextSpy.mockResolvedValue(defaultCtx);
});

describe("ankorstoreRefreshProduct", () => {
  it("returns error when product does not exist locally", async () => {
    loadExportProductsSpy.mockResolvedValue([]);

    const res = await ankorstoreRefreshProduct("missing");

    expect(res.success).toBe(false);
    if (!res.success) expect(res.reason).toBe("error");
    expect(ankorstoreSearchProductsByRefSpy).not.toHaveBeenCalled();
  });

  it("returns not_found when product does not exist on Ankorstore", async () => {
    loadExportProductsSpy.mockResolvedValue([mkExportProduct()]);
    ankorstoreSearchProductsByRefSpy.mockResolvedValue([]);

    const res = await ankorstoreRefreshProduct("p-1");

    expect(res.success).toBe(false);
    if (!res.success) {
      expect(res.reason).toBe("not_found");
      expect(res.error).toMatch(/inexistant/i);
    }
    expect(ankorstorePushProductsSpy).not.toHaveBeenCalled();
  });

  it("happy path — pushes with operationType 'update' and returns warning", async () => {
    loadExportProductsSpy.mockResolvedValue([mkExportProduct()]);
    ankorstoreSearchProductsByRefSpy.mockResolvedValue([
      { id: "ank-123", name: "Collier", variants: [] },
    ]);
    ankorstorePushProductsSpy.mockResolvedValue({ success: true, opId: "op-abc" });

    const res = await ankorstoreRefreshProduct("p-1");

    expect(res.success).toBe(true);
    if (res.success) {
      expect(res.opId).toBe("op-abc");
      expect(res.warning).toMatch(/vérifiez/i);
    }

    expect(ankorstorePushProductsSpy).toHaveBeenCalledTimes(1);
    const [pushedProducts, operationType] = ankorstorePushProductsSpy.mock.calls[0];
    expect(operationType).toBe("update");
    expect(pushedProducts).toHaveLength(1);
    const pushed = pushedProducts[0];
    expect(pushed.external_id).toBe("REF-1");
    expect(pushed.variants).toHaveLength(1);
    expect(pushed.variants[0].sku).toBe("REF-1_NOIR_UNIT_1");
    expect(pushed.variants[0].stock_quantity).toBe(10);
    expect(pushed.variants[0].options).toEqual(
      expect.arrayContaining([
        { name: "color", value: "Noir" },
        { name: "size", value: "TU" },
      ]),
    );
    expect(pushed.made_in_country).toBe("CN");
    expect(pushed.vat_rate).toBe(20);
  });

  it("returns error when Ankorstore push itself fails", async () => {
    loadExportProductsSpy.mockResolvedValue([mkExportProduct()]);
    ankorstoreSearchProductsByRefSpy.mockResolvedValue([{ id: "ank-1", variants: [] }]);
    ankorstorePushProductsSpy.mockResolvedValue({ success: false, error: "500 server error" });

    const res = await ankorstoreRefreshProduct("p-1");

    expect(res.success).toBe(false);
    if (!res.success) {
      expect(res.reason).toBe("error");
      expect(res.error).toMatch(/500 server error/);
    }
  });

  it("returns error when Ankorstore search throws", async () => {
    loadExportProductsSpy.mockResolvedValue([mkExportProduct()]);
    ankorstoreSearchProductsByRefSpy.mockRejectedValue(new Error("network fail"));

    const res = await ankorstoreRefreshProduct("p-1");

    expect(res.success).toBe(false);
    if (!res.success) {
      expect(res.reason).toBe("error");
      expect(res.error).toMatch(/network fail/);
    }
    expect(ankorstorePushProductsSpy).not.toHaveBeenCalled();
  });

  it("returns error when product has no variants", async () => {
    loadExportProductsSpy.mockResolvedValue([mkExportProduct({ variants: [] })]);
    ankorstoreSearchProductsByRefSpy.mockResolvedValue([{ id: "ank-1", variants: [] }]);

    const res = await ankorstoreRefreshProduct("p-1");

    expect(res.success).toBe(false);
    if (!res.success) {
      expect(res.reason).toBe("error");
      expect(res.error).toMatch(/variantes/i);
    }
  });

  it("PACK variant — computes per-unit price by dividing by packQuantity", async () => {
    loadExportProductsSpy.mockResolvedValue([
      mkExportProduct({
        variants: [
          {
            variantId: "v-pack",
            saleType: "PACK",
            colorNames: ["Doré"],
            packQuantity: 5,
            sizes: [],
            unitPrice: 50, // total pack price
            weight: 0.25,
            stock: 3,
            sku: "REF-1_DORE_PACK_1",
            imagePaths: [],
          },
        ],
      }),
    ]);
    ankorstoreSearchProductsByRefSpy.mockResolvedValue([{ id: "ank-1", variants: [] }]);
    ankorstorePushProductsSpy.mockResolvedValue({ success: true, opId: "op-1" });

    await ankorstoreRefreshProduct("p-1");

    const [pushedProducts] = ankorstorePushProductsSpy.mock.calls[0];
    const variant = pushedProducts[0].variants[0];
    // 50 / 5 = 10 per unit (with no markup)
    expect(variant.wholesalePrice).toBeCloseTo(10, 2);
    expect(variant.unit_multiplier).toBe(5);
  });
});
