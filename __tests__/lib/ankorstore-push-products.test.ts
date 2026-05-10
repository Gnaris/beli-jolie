/**
 * Tests pour lib/ankorstore-publish.ts
 *
 * Vérifie le payload JSON envoyé à Ankorstore (via ankorstoreAddProductsToOperation)
 * pour différents types de produits : UNIT mono-couleur, PACK mono-couleur, PACK multi-couleurs,
 * country_code, et les prix wholesale/retail.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// ─────────────────────────────────────────────
// Mocks (déclarés avant tout import)
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

// ─────────────────────────────────────────────
// API write mocks — on capture les arguments
// ─────────────────────────────────────────────

const mockCreateCatalogOperation = vi.fn().mockResolvedValue({ operationId: "op1" });
const mockAddProductsToOperation = vi.fn().mockResolvedValue(undefined);
const mockStartOperation = vi.fn().mockResolvedValue(undefined);
const mockPollOperation = vi.fn().mockResolvedValue({
  status: "succeeded",
  results: [
    {
      externalProductId: "REF1",
      ankorstoreProductId: "ank-1",
      status: "success",
      failureReason: null,
      issues: [],
    },
  ],
});
const mockDeleteProduct = vi.fn().mockResolvedValue(undefined);

vi.mock("@/lib/ankorstore-api-write", () => ({
  ankorstoreCreateCatalogOperation: (...args: unknown[]) => mockCreateCatalogOperation(...args),
  ankorstoreAddProductsToOperation: (...args: unknown[]) => mockAddProductsToOperation(...args),
  ankorstoreStartOperation: (...args: unknown[]) => mockStartOperation(...args),
  ankorstorePollOperation: (...args: unknown[]) => mockPollOperation(...args),
  ankorstoreDeleteProduct: (...args: unknown[]) => mockDeleteProduct(...args),
}));

// ─────────────────────────────────────────────
// API read mock (getVariants)
// ─────────────────────────────────────────────

const mockGetVariants = vi.fn().mockResolvedValue([
  {
    id: "ank-v1",
    sku: "REF1_argent_UNIT_1",
    ian: null,
    name: "M",
    retailPrice: 0,
    wholesalePrice: 0,
    availableQuantity: null,
    stockQuantity: 100,
    isAlwaysInStock: false,
    options: [
      { name: "color", value: "Argent" },
      { name: "size", value: "M" },
    ],
  },
]);

vi.mock("@/lib/ankorstore-api", () => ({
  ankorstoreGetVariants: (...args: unknown[]) => mockGetVariants(...args),
}));

// ─────────────────────────────────────────────
// Prisma mock
// ─────────────────────────────────────────────

const mockProductFindUnique = vi.fn();
const mockProductUpdate = vi.fn().mockResolvedValue({});
const mockProductColorUpdate = vi.fn().mockResolvedValue({});
const mockTransaction = vi.fn().mockImplementation(async (ops: Promise<unknown>[]) => Promise.all(ops));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    product: {
      findUnique: (...args: unknown[]) => mockProductFindUnique(...args),
      update: (...args: unknown[]) => mockProductUpdate(...args),
    },
    productColor: {
      update: (...args: unknown[]) => mockProductColorUpdate(...args),
    },
    siteConfig: {
      findMany: vi.fn().mockResolvedValue([]),
    },
    companyInfo: {
      findFirst: vi.fn().mockResolvedValue({ shopName: "Test Shop" }),
    },
    $transaction: (...args: unknown[]) => mockTransaction(...args),
  },
}));

// ─────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────

/** Produit de base UNIT mono-couleur */
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
    category: {
      id: "cat1",
      pfsCategoryId: null,
      pfsGender: null,
      pfsFamilyId: null,
      pfsFamilyName: null,
      pfsCategoryName: null,
    },
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
    compositions: [
      {
        percentage: 92.5,
        composition: { name: "Argent 925", pfsCompositionRef: null },
      },
    ],
    manufacturingCountry: { isoCode: "FR", pfsCountryRef: null },
    season: null,
    ...overrides,
  };
}

// ─────────────────────────────────────────────
// Suite
// ─────────────────────────────────────────────

describe("ankorstorePublishProduct — payload JSON envoyé", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockCreateCatalogOperation.mockResolvedValue({ operationId: "op1" });
    mockAddProductsToOperation.mockResolvedValue(undefined);
    mockStartOperation.mockResolvedValue(undefined);
    mockPollOperation.mockResolvedValue({
      status: "succeeded",
      results: [
        {
          externalProductId: "REF1",
          ankorstoreProductId: "ank-1",
          status: "success",
          failureReason: null,
          issues: [],
        },
      ],
    });
    mockProductUpdate.mockResolvedValue({});
    mockProductColorUpdate.mockResolvedValue({});
    mockTransaction.mockImplementation(async (ops: Promise<unknown>[]) => Promise.all(ops));
  });

  // ────────────────────────────────────────────
  // Test 1 : UNIT mono-couleur
  // ────────────────────────────────────────────
  it("UNIT mono-color → 1 entrée variante par (color, size)", async () => {
    const { ankorstorePublishProduct } = await import("@/lib/ankorstore-publish");

    mockProductFindUnique.mockResolvedValue(makeUnitProduct());
    mockGetVariants.mockResolvedValue([
      {
        id: "ank-v1",
        sku: "REF1_argent_UNIT_1",
        ian: null,
        name: "M",
        retailPrice: 0,
        wholesalePrice: 0,
        availableQuantity: null,
        stockQuantity: 100,
        isAlwaysInStock: false,
        options: [
          { name: "color", value: "Argent" },
          { name: "size", value: "M" },
        ],
      },
    ]);

    const result = await ankorstorePublishProduct("p1");
    expect(result.success).toBe(true);

    // Vérifier que addProductsToOperation a été appelé
    expect(mockAddProductsToOperation).toHaveBeenCalledOnce();
    const [operationId, products] = mockAddProductsToOperation.mock.calls[0];
    expect(operationId).toBe("op1");

    const product = products[0];
    // external_id = reference produit
    expect(product.externalId).toBe("REF1");

    // Payload variants : 1 entrée UNIT
    expect(product.variants).toHaveLength(1);
    const variant = product.variants[0];

    // SKU suit le pattern {ref}_{colorSlug}_{UNIT|PACK}_{index}
    expect(variant.sku).toMatch(/^REF1_/);
    expect(variant.sku).toMatch(/UNIT/);

    // options : color + size
    expect(variant.options).toEqual(
      expect.arrayContaining([
        { name: "color", value: "Argent" },
        { name: "size", value: "M" },
      ]),
    );

    // Vérifier que le payload sérialisé (comme l'API le voit) contient les bons champs
    // Le payload est transformé dans ankorstoreAddProductsToOperation en snake_case
    // On vérifie via le productInput (argument direct de la fonction mockée)
    expect(product.countryCode).toBe("FR");
    expect(typeof product.wholesalePrice).toBe("number");
    expect(typeof product.retailPrice).toBe("number");
  });

  // ────────────────────────────────────────────
  // Test 2 : PACK mono-couleur
  // ────────────────────────────────────────────
  it("PACK mono-color → 1 entrée variante avec unitMultiplier = packQuantity implicite", async () => {
    const { ankorstorePublishProduct } = await import("@/lib/ankorstore-publish");

    const packProduct = makeUnitProduct({
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
    });

    mockProductFindUnique.mockResolvedValue(packProduct);
    mockGetVariants.mockResolvedValue([
      {
        id: "ank-v2",
        sku: "REF1_blanc_PACK_1",
        ian: null,
        name: "M",
        retailPrice: 0,
        wholesalePrice: 0,
        availableQuantity: null,
        stockQuantity: 50,
        isAlwaysInStock: false,
        options: [
          { name: "color", value: "Blanc" },
          { name: "size", value: "M" },
        ],
      },
    ]);

    const result = await ankorstorePublishProduct("p1");
    expect(result.success).toBe(true);

    expect(mockAddProductsToOperation).toHaveBeenCalledOnce();
    const [, products] = mockAddProductsToOperation.mock.calls[0];
    const product = products[0];

    // PACK → 1 seule entrée variante
    expect(product.variants).toHaveLength(1);
    const variant = product.variants[0];

    expect(variant.sku).toMatch(/^REF1_/);
    expect(variant.sku).toMatch(/PACK/);
    expect(variant.options).toEqual(
      expect.arrayContaining([
        { name: "color", value: "Blanc" },
        { name: "size", value: "M" },
      ]),
    );

    // stockQuantity présent
    expect(variant.stockQuantity).toBe(50);
  });

  // ────────────────────────────────────────────
  // Test 3 : PACK multi-couleurs
  // ────────────────────────────────────────────
  it("PACK multi-color → options.color joint avec '/'", async () => {
    const { ankorstorePublishProduct } = await import("@/lib/ankorstore-publish");

    const multiColorPackProduct = makeUnitProduct({
      colors: [
        {
          id: "v3",
          unitPrice: 60,
          weight: 0.30,
          stock: 20,
          isPrimary: true,
          saleType: "PACK",
          packQuantity: 6,
          sku: null,
          variantSizes: [],
          colorId: "c1",
          color: { id: "c1", name: "Rouge" },
          packLines: [
            {
              colorId: "c1",
              color: { id: "c1", name: "Rouge" },
              position: 0,
              sizes: [{ size: { name: "S" }, quantity: 2 }],
            },
            {
              colorId: "c2",
              color: { id: "c2", name: "Bleu" },
              position: 1,
              sizes: [{ size: { name: "M" }, quantity: 2 }],
            },
            {
              colorId: "c3",
              color: { id: "c3", name: "Noir" },
              position: 2,
              sizes: [{ size: { name: "L" }, quantity: 2 }],
            },
          ],
          images: [],
        },
      ],
    });

    mockProductFindUnique.mockResolvedValue(multiColorPackProduct);
    mockGetVariants.mockResolvedValue([
      {
        id: "ank-v3",
        sku: "REF1_rouge_PACK_1",
        ian: null,
        name: "S",
        retailPrice: 0,
        wholesalePrice: 0,
        availableQuantity: null,
        stockQuantity: 20,
        isAlwaysInStock: false,
        options: [
          { name: "color", value: "Rouge/Bleu/Noir" },
          { name: "size", value: "S" },
        ],
      },
    ]);

    const result = await ankorstorePublishProduct("p1");
    expect(result.success).toBe(true);

    expect(mockAddProductsToOperation).toHaveBeenCalledOnce();
    const [, products] = mockAddProductsToOperation.mock.calls[0];
    const product = products[0];

    expect(product.variants).toHaveLength(1);
    const variant = product.variants[0];

    // La couleur doit être le join des packLines
    const colorOption = variant.options.find(
      (o: { name: string; value: string }) => o.name === "color",
    );
    expect(colorOption).toBeDefined();
    expect(colorOption!.value).toBe("Rouge/Bleu/Noir");
  });

  // ────────────────────────────────────────────
  // Test 4 : country_code depuis manufacturingCountry.isoCode
  // ────────────────────────────────────────────
  it("made_in_country provient de manufacturingCountry.isoCode", async () => {
    const { ankorstorePublishProduct } = await import("@/lib/ankorstore-publish");

    const cnProduct = makeUnitProduct({
      manufacturingCountry: { isoCode: "CN", pfsCountryRef: "Chine" },
    });

    mockProductFindUnique.mockResolvedValue(cnProduct);
    mockGetVariants.mockResolvedValue([
      {
        id: "ank-v1",
        sku: "REF1_argent_UNIT_1",
        ian: null,
        name: "M",
        retailPrice: 0,
        wholesalePrice: 0,
        availableQuantity: null,
        stockQuantity: 100,
        isAlwaysInStock: false,
        options: [{ name: "color", value: "Argent" }, { name: "size", value: "M" }],
      },
    ]);

    const result = await ankorstorePublishProduct("p1");
    expect(result.success).toBe(true);

    expect(mockAddProductsToOperation).toHaveBeenCalledOnce();
    const [, products] = mockAddProductsToOperation.mock.calls[0];
    const product = products[0];

    // Le champ dans l'input TypeScript s'appelle countryCode (converti en made_in_country par ankorstoreAddProductsToOperation)
    expect(product.countryCode).toBe("CN");
  });

  // ────────────────────────────────────────────
  // Test 5 : prix wholesale et retail avec markup
  // ────────────────────────────────────────────
  it("wholesale et retail prices avec markup appliqué", async () => {
    const { ankorstorePublishProduct } = await import("@/lib/ankorstore-publish");
    const { loadAnkorstorePricingConfig, getAnkorstorePackedPrice } = await import(
      "@/lib/ankorstore-pricing"
    );

    // Markup wholesale +20%, retail +50%
    vi.mocked(loadAnkorstorePricingConfig).mockResolvedValue({
      wholesale: { type: "percent", value: 20, rounding: "none" },
      retail: { type: "percent", value: 50, rounding: "none" },
      vatRate: 20,
    });

    // getAnkorstorePackedPrice est aussi mocké → on simule le calcul manuellement
    // wholesale: 10 + 20% = 12, retail: 10 + 50% = 15
    vi.mocked(getAnkorstorePackedPrice)
      .mockImplementationOnce(() => 12) // premier appel = wholesale
      .mockImplementationOnce(() => 15); // deuxième appel = retail

    mockProductFindUnique.mockResolvedValue(makeUnitProduct());
    mockGetVariants.mockResolvedValue([
      {
        id: "ank-v1",
        sku: "REF1_argent_UNIT_1",
        ian: null,
        name: "M",
        retailPrice: 0,
        wholesalePrice: 0,
        availableQuantity: null,
        stockQuantity: 100,
        isAlwaysInStock: false,
        options: [{ name: "color", value: "Argent" }, { name: "size", value: "M" }],
      },
    ]);

    const result = await ankorstorePublishProduct("p1");
    expect(result.success).toBe(true);

    expect(mockAddProductsToOperation).toHaveBeenCalledOnce();
    const [, products] = mockAddProductsToOperation.mock.calls[0];
    const product = products[0];

    // Les prix dans l'input TypeScript (avant conversion snake_case)
    expect(product.wholesalePrice).toBe(12);
    expect(product.retailPrice).toBe(15);
  });
});
