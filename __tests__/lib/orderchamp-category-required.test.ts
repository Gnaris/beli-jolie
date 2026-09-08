/**
 * Orderchamp — refus catégorique quand la catégorie BJ n'est pas mappée à
 * une feuille OC.
 *
 * Régression observée 2026-09-08 sur le tenant Issyma : un produit sans
 * mapping de catégorie a quand même été créé chez Orderchamp parce que le
 * publish/update tolérait un `resolveOrderchampCategoryForProduct` en
 * `{ ok: false }` et se contentait d'omettre le champ `category`. Ce test
 * verrouille le contrat inverse : sans mapping → aucune requête GraphQL,
 * l'erreur remonte telle quelle à l'UI.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const {
  orderchampGraphQLSpy,
  prismaFindUniqueSpy,
  loadOrderchampProductFullSpy,
  resolveOrderchampCategoryForProductSpy,
} = vi.hoisted(() => ({
  orderchampGraphQLSpy: vi.fn(),
  prismaFindUniqueSpy: vi.fn(),
  loadOrderchampProductFullSpy: vi.fn(),
  resolveOrderchampCategoryForProductSpy: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    product: {
      findUnique: (...a: unknown[]) => prismaFindUniqueSpy(...a),
      update: vi.fn(),
    },
    productColor: { update: vi.fn() },
    $transaction: vi.fn(),
  },
}));
vi.mock("@/lib/orderchamp-client", () => ({
  orderchampGraphQL: orderchampGraphQLSpy,
  extractUserErrors: () => [],
  formatUserErrors: () => null,
}));
vi.mock("@/lib/orderchamp-queries", () => ({
  PRODUCT_CREATE_MUTATION: "mutation ProductCreate",
  PRODUCT_UPDATE_MUTATION: "mutation ProductUpdate",
  PRODUCT_VARIANT_UPDATE_MUTATION: "mutation ProductVariantUpdate",
  PRODUCT_PUBLISH_MUTATION: "mutation ProductPublish",
}));
vi.mock("@/lib/orderchamp-storefront", () => ({
  getOrderchampStorefrontId: async () => null,
}));
vi.mock("@/lib/orderchamp-custom-category", () => ({
  ensureOrderchampCustomCategory: vi.fn(),
  ensureOrderchampSubCategoryCustomCategory: vi.fn(),
}));
vi.mock("@/lib/orderchamp-category-resolve", () => ({
  resolveOrderchampCategoryForProduct: (...a: unknown[]) =>
    resolveOrderchampCategoryForProductSpy(...a),
}));
vi.mock("@/lib/orderchamp-pricing", () => ({
  loadOrderchampPricingConfig: async () => ({
    wholesale: { type: "percent", value: 0, rounding: "none" },
    retail: { type: "multiplier", value: 3, rounding: "none" },
  }),
  getOrderchampWholesalePrice: () => 5,
  getOrderchampChainedRetailPrice: () => 15,
}));
vi.mock("@/lib/orderchamp-description", () => ({
  buildOrderchampDescription: () => "desc",
}));
vi.mock("@/lib/orderchamp-country", () => ({
  resolveOrderchampCountry: () => "CN",
}));
vi.mock("@/lib/orderchamp-shape", () => ({
  validateOrderchampProductShape: () => ({ ok: true, errors: [], warnings: [] }),
}));
vi.mock("@/lib/orderchamp-sku", () => ({
  buildOrderchampVariantSkus: (_ref: string, variants: { id: string }[]) =>
    new Map(variants.map((v) => [v.id, `SKU-${v.id}`])),
}));
vi.mock("@/lib/orderchamp-sync-diff", () => ({
  ORDERCHAMP_SNAPSHOT_VERSION: 1,
}));
vi.mock("@/lib/orderchamp-inventory", () => ({
  orderchampAdjustInventory: vi.fn(),
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

import { orderchampPublishProduct } from "@/lib/orderchamp-publish";
import { orderchampUpdateProduct } from "@/lib/orderchamp-update";

const NOT_MAPPED_ERROR =
  "La catégorie « Bracelet » n'est pas encore reliée à Orderchamp. Allez dans Catégories → « Bracelet » → carte Orderchamp pour choisir la catégorie du marché.";

beforeEach(() => {
  vi.clearAllMocks();
  resolveOrderchampCategoryForProductSpy.mockResolvedValue({
    ok: false,
    error: NOT_MAPPED_ERROR,
  });
});

describe("Orderchamp — mapping catégorie obligatoire", () => {
  it("orderchampPublishProduct refuse si la catégorie BJ n'est pas mappée", async () => {
    prismaFindUniqueSpy.mockResolvedValue({
      id: "p1",
      category: { id: "cat-1" },
      subCategories: [],
      colors: [],
    });
    // On ne doit JAMAIS atteindre loadOrderchampProductFull ni GraphQL.
    loadOrderchampProductFullSpy.mockRejectedValue(new Error("ne doit pas être appelé"));

    const res = await orderchampPublishProduct("p1");
    expect(res.success).toBe(false);
    expect(res.error).toBe(NOT_MAPPED_ERROR);
    expect(orderchampGraphQLSpy).not.toHaveBeenCalled();
  });

  it("orderchampUpdateProduct refuse si le produit est déjà lié mais que la catégorie n'est plus mappée", async () => {
    prismaFindUniqueSpy.mockResolvedValueOnce({
      orderchampProductId: "gid://orderchamp/Product/1",
      status: "ONLINE",
      orderchampLastSyncSnapshot: null,
    });

    const res = await orderchampUpdateProduct("p1");
    expect(res.success).toBe(false);
    expect(res.error).toBe(NOT_MAPPED_ERROR);
    expect(orderchampGraphQLSpy).not.toHaveBeenCalled();
  });
});
