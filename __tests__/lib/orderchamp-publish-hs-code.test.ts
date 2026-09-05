/**
 * Orderchamp publish — placement du code SH (numéro douanier) dans le payload
 * `productCreate`.
 *
 * Bug corrigé 2026-09-05 : `buildOrderchampProductPayload` mettait `hsCode`
 * sur chaque variante du `productCreate.input.variants[]`. Or ce champ
 * n'existe pas sur `ProductCreateVariantInput` côté OC (seulement sur
 * `ProductVariantUpdateInput`) → le GraphQL rejetait toute la mutation avec
 * `Field "hsCode" is not defined by type "ProductCreateVariantInput"`.
 *
 * Fix : `hsCode` reste au niveau produit dans `productCreate` (OC l'accepte
 * là), et la post-passe `productVariantUpdate/postCreate` — qui de toute
 * façon attribue déjà l'image par variante — se charge de le propager sur
 * chaque variante.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const {
  orderchampGraphQLSpy,
  prismaFindUniqueSpy,
  prismaProductUpdateSpy,
  prismaProductColorUpdateSpy,
  prismaTransactionSpy,
  loadOrderchampProductFullSpy,
  ensureOrderchampCustomCategorySpy,
  ensureOrderchampSubCategoryCustomCategorySpy,
  loadOrderchampPricingConfigSpy,
  getOrderchampStorefrontIdSpy,
} = vi.hoisted(() => ({
  orderchampGraphQLSpy: vi.fn(),
  prismaFindUniqueSpy: vi.fn(),
  prismaProductUpdateSpy: vi.fn().mockResolvedValue({}),
  prismaProductColorUpdateSpy: vi.fn().mockResolvedValue({}),
  prismaTransactionSpy: vi.fn(),
  loadOrderchampProductFullSpy: vi.fn(),
  ensureOrderchampCustomCategorySpy: vi.fn(),
  ensureOrderchampSubCategoryCustomCategorySpy: vi.fn(),
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
  ensureOrderchampSubCategoryCustomCategory: ensureOrderchampSubCategoryCustomCategorySpy,
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

import { orderchampPublishProduct, loadOrderchampProductFull } from "@/lib/orderchamp-publish";

const OC_PRODUCT_ID = "gid://orderchamp/Product/1";
const OC_VARIANT_ID = "gid://orderchamp/ProductVariant/42";
const HS_CODE = "71171900";
const SKU = "SKU-v-bleu";

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
        orderchampVariantId: null,
        orderchampColorNameOverride: null,
        saleType: "UNIT" as const,
        packQuantity: null,
        unitPrice: 5,
        weight: 0.025,
        stock: 10,
        isPrimary: true,
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
  ensureOrderchampCustomCategorySpy.mockResolvedValue({
    success: true,
    orderchampCustomCategoryId: "cc-1",
  });
  loadOrderchampPricingConfigSpy.mockResolvedValue({
    wholesale: { type: "percent", value: 0, rounding: "none" },
    retail: { type: "multiplier", value: 3, rounding: "none" },
  });
  getOrderchampStorefrontIdSpy.mockResolvedValue(null); // pas de storefront → skip publish, ok
  // $transaction reçoit une callback (tx) => ... — on lui passe des stubs prisma
  prismaTransactionSpy.mockImplementation(async (cb: (tx: unknown) => Promise<unknown>) => {
    return cb({
      product: { update: prismaProductUpdateSpy },
      productColor: { update: prismaProductColorUpdateSpy },
    });
  });
  // productCreate renvoie 1 variante avec le SKU attendu
  orderchampGraphQLSpy.mockResolvedValue({
    productCreate: {
      product: {
        id: OC_PRODUCT_ID,
        variants: {
          edges: [
            {
              node: { id: OC_VARIANT_ID, sku: SKU, option1: "Bleu", option2: "One Size" },
            },
          ],
        },
        images: { edges: [] },
      },
      userErrors: [],
    },
    productVariantUpdate: { productVariant: { id: OC_VARIANT_ID }, userErrors: [] },
    product: { images: { edges: [] } },
  });
});

describe("orderchampPublishProduct — code SH", () => {
  it("n'envoie PAS hsCode sur les variantes de productCreate (rejeté par OC) mais le pose au niveau produit + via productVariantUpdate/postCreate", async () => {
    loadOrderchampProductFullSpy.mockResolvedValue(baseProduct({ code: HS_CODE }));
    // Rebinde `loadOrderchampProductFull` du vrai module vers le spy sans mock
    // partiel — plus simple : on stub la fonction exportée en la remplaçant.
    // (Vitest ne permet pas la ré-assignation directe des ES exports, donc on
    // passe par un vi.mocked wrapper : on n'a pas besoin ici puisque publish
    // appelle `loadOrderchampProductFull` via son symbole interne — cf. plus
    // bas, on mock `@/lib/orderchamp-publish` partiellement n'est pas
    // pertinent. Solution : le vrai `loadOrderchampProductFull` va chercher
    // en DB → on doit intercepter avant. On mocke prismaFindUniqueSpy.)
    // `resolveOrderchampCategoryForProduct` est mocké au niveau module, donc
    // `prisma.product.findUnique` n'est appelé QUE par `loadOrderchampProductFull`.
    prismaFindUniqueSpy.mockResolvedValue(baseProduct({ code: HS_CODE }));

    const res = await orderchampPublishProduct("p1");
    expect(res.success).toBe(true);

    const createCall = orderchampGraphQLSpy.mock.calls.find((c) => c[2] === "productCreate");
    expect(createCall).toBeDefined();
    const createInput = (createCall![1] as { input: Record<string, unknown> }).input;

    // Le code SH DOIT être au niveau produit (OC l'accepte là).
    expect(createInput.hsCode).toBe(HS_CODE);

    // Le code SH NE DOIT PAS être sur les variantes (OC rejette).
    const variants = (createInput.variants as Record<string, unknown>[]) ?? [];
    expect(variants.length).toBeGreaterThan(0);
    for (const v of variants) {
      expect(v).not.toHaveProperty("hsCode");
    }

    // Post-passe : au moins un productVariantUpdate/postCreate doit propager
    // le hsCode côté variante pour que les updates futurs le voient.
    const postCreateCallsWithHs = orderchampGraphQLSpy.mock.calls.filter((c) => {
      if (c[2] !== "productVariantUpdate/postCreate") return false;
      const inp = (c[1] as { input?: Record<string, unknown> } | undefined)?.input;
      return inp?.hsCode === HS_CODE;
    });
    expect(postCreateCallsWithHs.length).toBeGreaterThan(0);
  });

  it("omet hsCode partout quand le produit BJ n'en a pas", async () => {
    prismaFindUniqueSpy.mockResolvedValue(baseProduct(null));

    const res = await orderchampPublishProduct("p1");
    expect(res.success).toBe(true);

    for (const call of orderchampGraphQLSpy.mock.calls) {
      const input = (call[1] as { input?: Record<string, unknown> } | undefined)?.input;
      if (!input) continue;
      expect(input).not.toHaveProperty("hsCode");
      const variants = (input.variants as Record<string, unknown>[] | undefined) ?? [];
      for (const v of variants) expect(v).not.toHaveProperty("hsCode");
    }
  });
});

// Silence l'avertissement sur l'import inutile (on garde l'import pour matcher
// le comportement réel du module, même si on court-circuite la fonction via
// le mock prismaFindUniqueSpy).
void loadOrderchampProductFull;
