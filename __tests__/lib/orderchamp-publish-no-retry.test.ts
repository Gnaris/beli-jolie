/**
 * Orderchamp — `productPublish` doit être non-retryable.
 *
 * Incident 2026-10-08 (J119A, A1675A) : la mutation `productPublish` n'est pas
 * idempotente côté OC. En cas de retry sur 5xx / erreur réseau, chaque passage
 * crée une variante listing fantôme → le listing finit avec N copies de la
 * même variante → OC affiche « Variants duplicate » et marque la fiche
 * `failed`.
 *
 * Fix : passer `disableRetry: true` à `orderchampGraphQL` pour cet appel.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const {
  orderchampGraphQLSpy,
  prismaFindUniqueSpy,
  prismaProductUpdateSpy,
  prismaProductColorUpdateSpy,
  prismaTransactionSpy,
  ensureOrderchampCustomCategorySpy,
  loadOrderchampPricingConfigSpy,
  getOrderchampStorefrontIdSpy,
} = vi.hoisted(() => ({
  orderchampGraphQLSpy: vi.fn(),
  prismaFindUniqueSpy: vi.fn(),
  prismaProductUpdateSpy: vi.fn().mockResolvedValue({}),
  prismaProductColorUpdateSpy: vi.fn().mockResolvedValue({}),
  prismaTransactionSpy: vi.fn(),
  ensureOrderchampCustomCategorySpy: vi.fn(),
  loadOrderchampPricingConfigSpy: vi.fn(),
  getOrderchampStorefrontIdSpy: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    product: {
      findUnique: (...a: unknown[]) => prismaFindUniqueSpy(...a),
      update: (...a: unknown[]) => prismaProductUpdateSpy(...a),
    },
    productColor: {
      update: (...a: unknown[]) => prismaProductColorUpdateSpy(...a),
    },
    $transaction: (...a: unknown[]) => prismaTransactionSpy(...a),
  },
}));
vi.mock("@/lib/orderchamp-client", () => ({
  orderchampGraphQL: orderchampGraphQLSpy,
  extractUserErrors: () => [],
  formatUserErrors: () => null,
}));
vi.mock("@/lib/orderchamp-queries", () => ({
  PRODUCT_CREATE_MUTATION: "mutation ProductCreate",
  PRODUCT_VARIANT_UPDATE_MUTATION: "mutation ProductVariantUpdate",
  PRODUCT_PUBLISH_MUTATION: "mutation ProductPublish",
}));
vi.mock("@/lib/orderchamp-storefront", () => ({
  getOrderchampStorefrontId: getOrderchampStorefrontIdSpy,
}));
vi.mock("@/lib/orderchamp-custom-category", () => ({
  ensureOrderchampCustomCategory: ensureOrderchampCustomCategorySpy,
  ensureOrderchampSubCategoryCustomCategory: vi.fn(),
}));
vi.mock("@/lib/orderchamp-category-resolve", () => ({
  resolveOrderchampCategoryForProduct: async () => ({
    ok: true,
    path: "JEWELRY_ACCESSORIES_BRACELETS_OTHER",
  }),
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
import {
  orderchampRepublishProductVisibility,
} from "@/lib/orderchamp-delete";

const OC_PRODUCT_ID = "gid://orderchamp/Product/1";
const OC_VARIANT_ID = "gid://orderchamp/ProductVariant/42";
const STOREFRONT_ID = "gid://orderchamp/Storefront/99";

function baseProduct() {
  return {
    id: "p1",
    reference: "J119A",
    name: "Collier",
    description: "desc",
    status: "ONLINE",
    countryIsoCode: "CN",
    hsCode: null,
    dimensionLength: 60,
    dimensionWidth: 60,
    dimensionHeight: 3,
    dimensionDiameter: null,
    sizeDetailsTu: null,
    primaryColorId: "c-blanc",
    category: { id: "cat-1", name: "Colliers" },
    subCategories: [],
    compositions: [],
    colors: [
      {
        id: "v-blanc",
        orderchampVariantId: null,
        orderchampColorNameOverride: null,
        saleType: "UNIT" as const,
        packQuantity: null,
        unitPrice: 5,
        weight: 0.025,
        stock: 10,
        isPrimary: true,
        disabled: false,
        colorId: "c-blanc",
        color: { id: "c-blanc", name: "Blanc" },
        variantSizes: [],
      },
    ],
    colorImages: [],
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  ensureOrderchampCustomCategorySpy.mockResolvedValue({
    success: true,
    orderchampCustomCategoryId: "cc-1",
  });
  loadOrderchampPricingConfigSpy.mockResolvedValue({
    wholesale: { type: "percent", value: 0, rounding: "none" },
    retail: { type: "multiplier", value: 3, rounding: "none" },
  });
  // Storefront résolu → publish/postCreate sera appelé
  getOrderchampStorefrontIdSpy.mockResolvedValue(STOREFRONT_ID);
  prismaTransactionSpy.mockImplementation(
    async (cb: (tx: unknown) => Promise<unknown>) =>
      cb({
        product: { update: prismaProductUpdateSpy },
        productColor: { update: prismaProductColorUpdateSpy },
      }),
  );
  // Chaque appel GraphQL retourne le payload approprié selon opName
  orderchampGraphQLSpy.mockImplementation(
    async (_q: string, _v: unknown, opName: string) => {
      if (opName === "productCreate") {
        return {
          productCreate: {
            product: {
              id: OC_PRODUCT_ID,
              variants: {
                edges: [
                  {
                    node: {
                      id: OC_VARIANT_ID,
                      sku: "SKU-v-blanc",
                      option1: "Blanc",
                      option2: "One Size",
                    },
                  },
                ],
              },
              images: { edges: [] },
            },
            userErrors: [],
          },
        };
      }
      if (opName === "productPublish/postCreate" || opName === "productPublish") {
        return {
          productPublish: {
            product: { id: OC_PRODUCT_ID },
            listing: { id: "L1", status: "published" },
            userErrors: [],
          },
        };
      }
      return { productVariantUpdate: { productVariant: { id: OC_VARIANT_ID }, userErrors: [] } };
    },
  );
});

describe("Orderchamp productPublish — anti-doublon", () => {
  it("orderchampPublishProduct appelle productPublish/postCreate avec disableRetry:true", async () => {
    prismaFindUniqueSpy.mockResolvedValue(baseProduct());

    const res = await orderchampPublishProduct("p1");
    expect(res.success).toBe(true);

    const publishCall = orderchampGraphQLSpy.mock.calls.find(
      (c) => c[2] === "productPublish/postCreate",
    );
    expect(publishCall).toBeDefined();
    // 4ᵉ argument de orderchampGraphQL = options { disableRetry }
    const options = publishCall![3] as { disableRetry?: boolean } | undefined;
    expect(options?.disableRetry).toBe(true);
  });

  it("orderchampRepublishProductVisibility appelle productPublish avec disableRetry:true", async () => {
    const res = await orderchampRepublishProductVisibility(OC_PRODUCT_ID);
    expect(res.success).toBe(true);

    const call = orderchampGraphQLSpy.mock.calls.find(
      (c) => c[2] === "productPublish",
    );
    expect(call).toBeDefined();
    const options = call![3] as { disableRetry?: boolean } | undefined;
    expect(options?.disableRetry).toBe(true);
  });
});
