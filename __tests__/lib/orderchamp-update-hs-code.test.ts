/**
 * Orderchamp update — propagation du code SH (numéro douanier) vers
 * `productUpdate.input.hsCode`.
 *
 * Avant fix : `orderchampUpdateProduct` construisait le payload sans
 * inclure `hsCode`, donc changer le code SH côté BJ ne se propageait
 * jamais chez Orderchamp — même après avoir lancé une synchronisation.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const {
  orderchampGraphQLSpy,
  prismaFindUniqueSpy,
  prismaProductUpdateSpy,
  loadOrderchampProductFullSpy,
  ensureOrderchampCustomCategorySpy,
  ensureOrderchampSubCategoryCustomCategorySpy,
  orderchampAdjustInventorySpy,
  loadOrderchampPricingConfigSpy,
} = vi.hoisted(() => ({
  orderchampGraphQLSpy: vi.fn(),
  prismaFindUniqueSpy: vi.fn(),
  prismaProductUpdateSpy: vi.fn().mockResolvedValue({}),
  loadOrderchampProductFullSpy: vi.fn(),
  ensureOrderchampCustomCategorySpy: vi.fn(),
  ensureOrderchampSubCategoryCustomCategorySpy: vi.fn(),
  orderchampAdjustInventorySpy: vi.fn(),
  loadOrderchampPricingConfigSpy: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    product: {
      findUnique: (...a: unknown[]) => prismaFindUniqueSpy(...a),
      update: (...a: unknown[]) => prismaProductUpdateSpy(...a),
    },
  },
}));
vi.mock("@/lib/orderchamp-client", () => ({
  orderchampGraphQL: orderchampGraphQLSpy,
  extractUserErrors: () => [],
  formatUserErrors: () => null,
}));
vi.mock("@/lib/orderchamp-queries", () => ({
  PRODUCT_UPDATE_MUTATION: "mutation ProductUpdate",
  PRODUCT_VARIANT_UPDATE_MUTATION: "mutation ProductVariantUpdate",
}));
vi.mock("@/lib/orderchamp-publish", () => ({
  loadOrderchampProductFull: loadOrderchampProductFullSpy,
  orderchampPublishProduct: vi.fn(),
}));
vi.mock("@/lib/orderchamp-custom-category", () => ({
  ensureOrderchampCustomCategory: ensureOrderchampCustomCategorySpy,
  ensureOrderchampSubCategoryCustomCategory: ensureOrderchampSubCategoryCustomCategorySpy,
}));
vi.mock("@/lib/orderchamp-inventory", () => ({
  orderchampAdjustInventory: orderchampAdjustInventorySpy,
}));
vi.mock("@/lib/orderchamp-pricing", () => ({
  loadOrderchampPricingConfig: loadOrderchampPricingConfigSpy,
  getOrderchampWholesalePrice: vi.fn().mockReturnValue(5),
  getOrderchampChainedRetailPrice: vi.fn().mockReturnValue(15),
}));
vi.mock("@/lib/orderchamp-description", () => ({
  buildOrderchampDescription: () => "desc",
}));
vi.mock("@/lib/orderchamp-country", () => ({
  resolveOrderchampCountry: () => "CN",
}));
vi.mock("@/lib/marketplace-image", () => ({
  buildOrderchampImageUrl: (path: string) => `https://example.test${path}`,
}));
vi.mock("@/lib/tenant", () => ({
  getCurrentTenantIdSafe: async () => "t1",
  getTenantBaseUrl: async () => "https://example.test",
}));
vi.mock("@/lib/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

import { orderchampUpdateProduct } from "@/lib/orderchamp-update";

const OC_PRODUCT_ID = "gid://orderchamp/Product/1";
const OC_VARIANT_ID = "gid://orderchamp/ProductVariant/42";
const HS_CODE = "71171900";

function baseProduct(hsCode: { code: string } | null) {
  return {
    id: "p1",
    reference: "A1720",
    name: "Bracelet",
    description: "desc",
    status: "ONLINE",
    countryIsoCode: "CN",
    hsCode,
    dimensionLength: 60,
    dimensionWidth: 60,
    dimensionHeight: 3,
    dimensionDiameter: null,
    sizeDetailsTu: null,
    primaryColorId: "c-bleu",
    category: { id: "cat-1", name: "Bracelets" },
    subCategories: [],
    compositions: [],
    colors: [
      {
        id: "v-bleu",
        orderchampVariantId: OC_VARIANT_ID,
        orderchampColorNameOverride: null,
        saleType: "UNIT" as const,
        packQuantity: null,
        unitPrice: 5,
        weight: 25,
        stock: 10,
        disabled: false,
        colorId: "c-bleu",
        color: { id: "c-bleu", name: "Bleu" },
        variantSizes: [],
      },
    ],
    colorImages: [],
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  prismaFindUniqueSpy.mockResolvedValue({
    orderchampProductId: OC_PRODUCT_ID,
    status: "ONLINE",
  });
  ensureOrderchampCustomCategorySpy.mockResolvedValue({
    success: true,
    orderchampCustomCategoryId: "cc-1",
  });
  loadOrderchampPricingConfigSpy.mockResolvedValue({
    wholesale: { type: "percent", value: 0, rounding: "none" },
    retail: { type: "multiplier", value: 3, rounding: "none" },
  });
  orderchampAdjustInventorySpy.mockResolvedValue({ updatedCount: 1, errors: [] });
  orderchampGraphQLSpy.mockResolvedValue({
    productUpdate: { product: { id: OC_PRODUCT_ID, images: { edges: [] } }, userErrors: [] },
    productVariantUpdate: { productVariant: { id: OC_VARIANT_ID }, userErrors: [] },
  });
});

describe("orderchampUpdateProduct — code SH", () => {
  it("envoie le code SH BJ dans productUpdate.input.hsCode", async () => {
    loadOrderchampProductFullSpy.mockResolvedValue(baseProduct({ code: HS_CODE }));

    const res = await orderchampUpdateProduct("p1");
    expect(res.success).toBe(true);

    const productUpdateCall = orderchampGraphQLSpy.mock.calls.find(
      (c) => c[2] === "productUpdate",
    );
    expect(productUpdateCall).toBeDefined();
    const input = (productUpdateCall![1] as { input: Record<string, unknown> }).input;
    expect(input.hsCode).toBe(HS_CODE);
  });

  it("omet hsCode du payload quand le produit BJ n'en a pas", async () => {
    loadOrderchampProductFullSpy.mockResolvedValue(baseProduct(null));

    const res = await orderchampUpdateProduct("p1");
    expect(res.success).toBe(true);

    const productUpdateCall = orderchampGraphQLSpy.mock.calls.find(
      (c) => c[2] === "productUpdate",
    );
    expect(productUpdateCall).toBeDefined();
    const input = (productUpdateCall![1] as { input: Record<string, unknown> }).input;
    expect(input).not.toHaveProperty("hsCode");
  });
});
