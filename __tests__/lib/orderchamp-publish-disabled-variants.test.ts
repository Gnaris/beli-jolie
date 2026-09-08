/**
 * Orderchamp publish — comportement quand toutes les variantes BJ sont
 * désactivées.
 *
 * Décision cliente 2026-09-08 : au lieu de refuser la publication (ancien
 * comportement — 3 erreurs « prix à 0 · prix à 0 · au moins une variante »),
 * on envoie chaque variante désactivée avec `inventoryQuantity = 0` pour
 * garder la fiche visible côté acheteuse en rupture temporaire.
 *
 * Le prix reste normal (pas 0) pour que l'acheteuse voie le prix affiché,
 * même en rupture.
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
  validateOrderchampProductShape: (input: {
    wholesalePriceCents: number;
    retailPriceCents: number;
    variants: unknown[];
  }) => {
    const errors: string[] = [];
    if (!input.wholesalePriceCents || input.wholesalePriceCents <= 0) {
      errors.push("Le prix de gros doit être supérieur à 0.");
    }
    if (!input.retailPriceCents || input.retailPriceCents <= 0) {
      errors.push("Le prix conseillé doit être supérieur à 0.");
    }
    if (!input.variants || input.variants.length === 0) {
      errors.push("Au moins une variante (couleur) est nécessaire.");
    }
    return { ok: errors.length === 0, errors, warnings: [] };
  },
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

const OC_PRODUCT_ID = "gid://orderchamp/Product/1";
const OC_VARIANT_ID = "gid://orderchamp/ProductVariant/42";
const SKU = "SKU-v-bleu";

function productWithAllDisabledVariants() {
  return {
    id: "p1",
    reference: "A1720",
    name: "Bracelet",
    description: "desc",
    status: "ONLINE",
    countryIsoCode: "CN",
    hsCode: null,
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
        stock: 12, // stock BJ non nul, mais désactivée
        isPrimary: true,
        disabled: true, // ← désactivée
        colorId: "c-bleu",
        color: { id: "c-bleu", name: "Bleu" },
        variantSizes: [],
      },
    ],
    // Aucune image dans ce test pour éviter le polling asynchrone `product(id)`
    // qui polle 30 × 3s = 90s quand OC renvoie `images.edges = []` (comportement
    // réel : OC télécharge les images de manière async après productCreate).
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
  getOrderchampStorefrontIdSpy.mockResolvedValue(null);
  prismaTransactionSpy.mockImplementation(async (cb: (tx: unknown) => Promise<unknown>) => {
    return cb({
      product: { update: prismaProductUpdateSpy },
      productColor: { update: prismaProductColorUpdateSpy },
    });
  });
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

describe("orderchampPublishProduct — variantes désactivées", () => {
  it("publie une fiche avec stock=0 quand la variante BJ est désactivée (au lieu de rejeter)", async () => {
    prismaFindUniqueSpy.mockResolvedValue(productWithAllDisabledVariants());

    const res = await orderchampPublishProduct("p1");

    // Avant le fix, ce publish échouait avec les 3 erreurs de shape
    // (prix à 0, prix à 0, au moins une variante). Le fix envoie la variante
    // avec stock=0 → publish OK.
    expect(res.success).toBe(true);

    const createCall = orderchampGraphQLSpy.mock.calls.find((c) => c[2] === "productCreate");
    expect(createCall).toBeDefined();
    const createInput = (createCall![1] as { input: Record<string, unknown> }).input;
    const variants = createInput.variants as Array<Record<string, unknown>>;

    // La variante désactivée est bien envoyée (fiche reste visible côté OC)…
    expect(variants).toHaveLength(1);
    // …mais avec stock=0 (rupture temporaire côté acheteuse).
    expect(variants[0]!.inventoryQuantity).toBe(0);
    // Le prix reste normal (le mock renvoie 5€ wholesale, 15€ retail).
    expect(variants[0]!.price).toBe(5);
    expect(variants[0]!.msrp).toBe(15);
  });
});
