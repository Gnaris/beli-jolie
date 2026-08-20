/**
 * Orderchamp update — propagation du renommage de la référence BJ vers le
 * SKU des variantes côté Orderchamp.
 *
 * Avant fix : `orderchampUpdateProduct` renvoyait uniquement filterMaterial
 * dans `productVariantUpdate`, jamais le sku. Renommer une référence BJ
 * laissait donc l'ancien code de variante intact chez Orderchamp bien que
 * le push soit reporté « réussi ».
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
vi.mock("@/lib/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

import { orderchampUpdateProduct } from "@/lib/orderchamp-update";

const NEW_REFERENCE = "A1721";
const OC_VARIANT_ID = "gid://orderchamp/ProductVariant/42";

beforeEach(() => {
  vi.clearAllMocks();
  prismaFindUniqueSpy.mockResolvedValue({
    orderchampProductId: "gid://orderchamp/Product/1",
    status: "ONLINE",
  });
  loadOrderchampProductFullSpy.mockResolvedValue({
    id: "p1",
    reference: NEW_REFERENCE,
    name: "Bracelet",
    description: "desc",
    status: "ONLINE",
    countryIsoCode: "CN",
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
        saleType: "UNIT",
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
    productUpdate: { product: { id: "gid://orderchamp/Product/1" }, userErrors: [] },
    productVariantUpdate: { productVariant: { id: OC_VARIANT_ID }, userErrors: [] },
  });
});

describe("orderchampUpdateProduct — rename SKU", () => {
  it("envoie le nouveau SKU calculé depuis la référence BJ à productVariantUpdate", async () => {
    const res = await orderchampUpdateProduct("p1");
    expect(res.success).toBe(true);

    const variantUpdateCalls = orderchampGraphQLSpy.mock.calls.filter(
      (c) => typeof c[2] === "string" && (c[2] as string).startsWith("productVariantUpdate"),
    );
    expect(variantUpdateCalls.length).toBeGreaterThan(0);

    const input = (variantUpdateCalls[0][1] as { input: Record<string, unknown> }).input;
    expect(input.id).toBe(OC_VARIANT_ID);
    expect(typeof input.sku).toBe("string");
    // Le SKU calculé doit démarrer par la nouvelle référence normalisée.
    expect((input.sku as string).toLowerCase().startsWith("a1721_")).toBe(true);
    expect(res.changedFields).toContain("sku");
  });
});
