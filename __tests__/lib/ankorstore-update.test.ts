/**
 * Tests pour lib/ankorstore-update.ts (mode callback-only).
 *
 * Couvre :
 *   1. Snapshot identique → 0 appel API + return success
 *   2. Stock seul change → PATCH stock + PATCH prices, AUCUNE op asynchrone
 *   3. forceFullSync → kickoff d'une op UPDATE asynchrone, row PENDING sauvée
 *   4. Pas de ankorsProductId → error sans appel API
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  ANKORSTORE_SNAPSHOT_VERSION,
  type AnkorstoreSyncSnapshot,
} from "@/lib/ankorstore-sync-diff";

vi.mock("@/lib/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

const mockRevalidateTag = vi.fn();
vi.mock("next/cache", () => ({
  revalidateTag: (...args: unknown[]) => mockRevalidateTag(...args),
  unstable_cache: <T extends (...args: never[]) => unknown>(fn: T) => fn,
}));
vi.mock("@/lib/product-events", () => ({ emitProductEvent: vi.fn() }));

const mockPatchVariantStock = vi.fn().mockResolvedValue(undefined);
const mockPatchVariantPrices = vi.fn().mockResolvedValue(undefined);
const mockCreateCatalogOperation = vi.fn().mockResolvedValue({ operationId: "op-test" });
const mockAddProductsToOperation = vi.fn().mockResolvedValue({ totalProductsCount: 1 });
const mockStartOperation = vi.fn().mockResolvedValue(undefined);
vi.mock("@/lib/ankorstore-api-write", () => ({
  ankorstorePatchVariantStock: (...args: unknown[]) => mockPatchVariantStock(...args),
  ankorstorePatchVariantPrices: (...args: unknown[]) => mockPatchVariantPrices(...args),
  ankorstoreCreateCatalogOperation: (...args: unknown[]) => mockCreateCatalogOperation(...args),
  ankorstoreAddProductsToOperation: (...args: unknown[]) => mockAddProductsToOperation(...args),
  ankorstoreStartOperation: (...args: unknown[]) => mockStartOperation(...args),
}));

vi.mock("@/lib/ankorstore-variant-link", () => ({
  autoLinkAnkorstoreVariants: vi.fn().mockResolvedValue({
    matchedExact: 0,
    matchedColor: 0,
    stillUnlinked: [],
  }),
}));

const mockGetVariants = vi.fn().mockResolvedValue([
  { id: "ank-variant-1", sku: "REF001_red_UNIT_1" },
  { id: "ank-variant-2", sku: "REF001_blue_UNIT_2" },
]);
vi.mock("@/lib/ankorstore-api", () => ({
  ankorstoreGetVariants: (...args: unknown[]) => mockGetVariants(...args),
}));

vi.mock("@/lib/ankorstore-pricing", () => ({
  loadAnkorstorePricingConfig: vi.fn().mockResolvedValue({
    wholesale: { type: "percent", value: 0, rounding: "none" },
    retail: { type: "percent", value: 0, rounding: "none" },
    vatRate: 20,
  }),
  getAnkorstorePackedPrice: vi.fn().mockImplementation((total: number) => total),
  getAnkorstoreChainedRetailPrice: vi.fn().mockImplementation((total: number) => total),
  toCents: (eur: number) => Math.round(eur * 100),
}));

vi.mock("@/lib/ankorstore-description", () => ({
  formatAnkorstoreDescription: vi.fn().mockImplementation(
    (input: { description: string; reference: string }) =>
      `${input.description}\n\nRéférence produit : ${input.reference}`,
  ),
  formatAnkorstoreCompositionLabel: vi.fn().mockReturnValue(null),
}));

const mockProductUpdate = vi.fn().mockResolvedValue({});
const mockAnkorstoreOperationCreate = vi.fn().mockResolvedValue({});
const mockAnkorstoreOperationUpdateMany = vi.fn().mockResolvedValue({ count: 0 });

vi.mock("@/lib/prisma", () => ({
  prisma: {
    product: {
      findUnique: vi.fn(),
      update: (...args: unknown[]) => mockProductUpdate(...args),
    },
    companyInfo: {
      findFirst: vi.fn().mockResolvedValue({ shopName: "Test Boutique" }),
    },
    productColor: {
      update: vi.fn().mockResolvedValue({}),
    },
    ankorstoreOperation: {
      create: (...args: unknown[]) => mockAnkorstoreOperationCreate(...args),
      updateMany: (...args: unknown[]) => mockAnkorstoreOperationUpdateMany(...args),
    },
    $transaction: vi.fn().mockResolvedValue([]),
  },
}));

import { prisma } from "@/lib/prisma";

const FORMATTED_DESC = "Test description\n\nRéférence produit : REF001";

function makeSnapshot(overrides?: Partial<AnkorstoreSyncSnapshot>): AnkorstoreSyncSnapshot {
  return {
    schemaVersion: ANKORSTORE_SNAPSHOT_VERSION,
    product: {
      externalId: "REF001",
      name: "Test Product",
      description: FORMATTED_DESC,
      vatRate: 20,
      countryCode: "FR",
      unitMultiplier: 1,
      brandName: "Test Boutique",
      weightGrams: 500,
      dimensionLengthMm: null,
      dimensionWidthMm: null,
      dimensionHeightMm: null,
      hsCode: null,
    },
    variants: {
      "ank-variant-1": {
        sku: "REF001_red_UNIT_1",
        wholesalePriceCents: 1000,
        retailPriceCents: 1000,
        stockQty: 10,
        isAlwaysInStock: false,
        optionColor: "Rouge",
        optionSize: "TU",
      },
    },
    images: {
      main: { "1": "/uploads/produits/ref001/ref001-red-1.webp" },
    },
    status: "active",
    ...overrides,
  };
}

function makeProduct(overrides?: Record<string, unknown>) {
  return {
    id: "product-1",
    reference: "REF001",
    name: "Test Product",
    description: "Test description",
    status: "ONLINE",
    primaryColorId: "color-1",
    ankorsProductId: "ank-product-1",
    ankorsLastSyncSnapshot: null,
    dimensionLength: null,
    dimensionWidth: null,
    dimensionHeight: null,
    dimensionDiameter: null,
    dimensionCircumference: null,
    sizeDetailsTu: null,
    category: { id: "cat-1", pfsCategoryId: null, pfsGender: null, pfsFamilyId: null, pfsFamilyName: null, pfsCategoryName: null },
    colors: [
      {
        id: "variant-1",
        ankorsVariantId: "ank-variant-1",
        unitPrice: 10,
        weight: 0.5,
        stock: 10,
        isPrimary: true,
        saleType: "UNIT",
        packQuantity: null,
        sku: "REF001_red_UNIT_1",
        variantSizes: [],
        colorId: "color-1",
        color: { id: "color-1", name: "Rouge" },
        packLines: [],
        images: [],
      },
    ],
    colorImages: [
      { path: "/uploads/produits/ref001/ref001-red-1.webp", order: 1, colorId: "color-1" },
    ],
    compositions: [],
    manufacturingCountry: { isoCode: "FR", pfsCountryRef: null },
    season: null,
    ...overrides,
  };
}

describe("ankorstoreKickoffUpdate (callback-only)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockPatchVariantStock.mockResolvedValue(undefined);
    mockPatchVariantPrices.mockResolvedValue(undefined);
    mockCreateCatalogOperation.mockResolvedValue({ operationId: "op-test" });
    mockAddProductsToOperation.mockResolvedValue({ totalProductsCount: 1 });
    mockStartOperation.mockResolvedValue(undefined);
    mockProductUpdate.mockResolvedValue({});
    mockAnkorstoreOperationCreate.mockResolvedValue({});
    mockAnkorstoreOperationUpdateMany.mockResolvedValue({ count: 0 });
    vi.mocked(prisma.companyInfo.findFirst).mockResolvedValue({ shopName: "Test Boutique" } as never);
  });

  it("Test 1: snapshot identique → aucun appel API + operationId null", async () => {
    const prevSnapshot = makeSnapshot();
    const product = makeProduct({ ankorsLastSyncSnapshot: prevSnapshot });
    vi.mocked(prisma.product.findUnique).mockResolvedValue(product as never);

    const { ankorstoreKickoffUpdate } = await import("@/lib/ankorstore-update");
    const result = await ankorstoreKickoffUpdate("product-1");

    expect(result).toEqual({ success: true, operationId: null, archived: false });

    expect(mockCreateCatalogOperation).not.toHaveBeenCalled();
    expect(mockPatchVariantStock).not.toHaveBeenCalled();
    expect(mockPatchVariantPrices).not.toHaveBeenCalled();
  });

  it("Test 2: stock seul change → PATCH stock + PATCH prices, aucune op asynchrone", async () => {
    const prevSnapshot = makeSnapshot();
    const product = makeProduct({
      ankorsLastSyncSnapshot: prevSnapshot,
      colors: [
        {
          id: "variant-1",
          ankorsVariantId: "ank-variant-1",
          unitPrice: 10,
          weight: 0.5,
          stock: 5,
          isPrimary: true,
          saleType: "UNIT",
          packQuantity: null,
          sku: "REF001_red_UNIT_1",
          variantSizes: [],
          colorId: "color-1",
          color: { id: "color-1", name: "Rouge" },
          packLines: [],
          images: [],
        },
      ],
    });
    vi.mocked(prisma.product.findUnique).mockResolvedValue(product as never);

    const { ankorstoreKickoffUpdate } = await import("@/lib/ankorstore-update");
    const result = await ankorstoreKickoffUpdate("product-1");

    expect(result).toEqual({ success: true, operationId: null, archived: false });
    expect(mockCreateCatalogOperation).not.toHaveBeenCalled();
    expect(mockPatchVariantStock).toHaveBeenCalledWith("ank-variant-1", {
      stockQuantity: 5,
      isAlwaysInStock: false,
    });
    expect(mockPatchVariantPrices).toHaveBeenCalledWith("ank-variant-1", {
      wholesalePriceCents: 1000,
      retailPriceCents: 1000,
    });
  });

  it("Test 3: forceFullSync → kickoff d'une op UPDATE asynchrone, row PENDING créée", async () => {
    const prevSnapshot = makeSnapshot();
    const product = makeProduct({ ankorsLastSyncSnapshot: prevSnapshot });
    vi.mocked(prisma.product.findUnique).mockResolvedValue(product as never);

    const { ankorstoreKickoffUpdate } = await import("@/lib/ankorstore-update");
    const result = await ankorstoreKickoffUpdate("product-1", { forceFullSync: true });

    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.operationId).toBe("op-test");

    expect(mockCreateCatalogOperation).toHaveBeenCalledWith("update");
    expect(mockAddProductsToOperation).toHaveBeenCalled();
    expect(mockStartOperation).toHaveBeenCalled();

    // Variant patches also applied synchronously
    expect(mockPatchVariantStock).toHaveBeenCalled();
    expect(mockPatchVariantPrices).toHaveBeenCalled();

    // AnkorstoreOperation row PENDING
    expect(mockAnkorstoreOperationCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          id: "op-test",
          type: "UPDATE",
          status: "PENDING",
        }),
      }),
    );
  });

  it("Test 4: pas de ankorsProductId → error sans appel API", async () => {
    const product = makeProduct({ ankorsProductId: null });
    vi.mocked(prisma.product.findUnique).mockResolvedValue(product as never);

    const { ankorstoreKickoffUpdate } = await import("@/lib/ankorstore-update");
    const result = await ankorstoreKickoffUpdate("product-1");

    expect(result).toEqual({
      success: false,
      error: "Produit non publié sur Ankorstore (pas de ankorsProductId)",
    });

    expect(mockCreateCatalogOperation).not.toHaveBeenCalled();
  });

  it("Test 5: changer primaryColorId déclenche bien un diff d'images → op asynchrone lancée", async () => {
    // Snapshot précédent : la couleur principale était color-1 (Rouge) → image rouge
    const prevSnapshot = makeSnapshot({
      images: {
        main: { "1": "/uploads/produits/ref001/ref001-red-1.webp" },
      },
    });

    // Nouveau produit : couleur principale = color-2 (Bleu).
    // Le produit a 2 variantes (color-1 et color-2), chacune avec leur image.
    // Bug avant fix : buildImagesSnapshot prenait colors[0] (= color-1, Rouge)
    // → snapshot d'images identique à prev → diff vide → aucun envoi Ankorstore.
    // Avec le fix : on prend primaryColorId (= color-2, Bleu) → image différente
    // → diff non vide → op asynchrone lancée.
    const product = makeProduct({
      ankorsLastSyncSnapshot: prevSnapshot,
      primaryColorId: "color-2",
      colors: [
        {
          id: "variant-1",
          ankorsVariantId: "ank-variant-1",
          unitPrice: 10,
          weight: 0.5,
          stock: 10,
          isPrimary: false,
          saleType: "UNIT",
          packQuantity: null,
          sku: "REF001_red_UNIT_1",
          variantSizes: [],
          colorId: "color-1",
          color: { id: "color-1", name: "Rouge" },
          packLines: [],
          images: [],
        },
        {
          id: "variant-2",
          ankorsVariantId: "ank-variant-2",
          unitPrice: 10,
          weight: 0.5,
          stock: 10,
          isPrimary: true,
          saleType: "UNIT",
          packQuantity: null,
          sku: "REF001_blue_UNIT_2",
          variantSizes: [],
          colorId: "color-2",
          color: { id: "color-2", name: "Bleu" },
          packLines: [],
          images: [],
        },
      ],
      colorImages: [
        { path: "/uploads/produits/ref001/ref001-red-1.webp", order: 1, colorId: "color-1" },
        { path: "/uploads/produits/ref001/ref001-blue-1.webp", order: 1, colorId: "color-2" },
      ],
    });
    vi.mocked(prisma.product.findUnique).mockResolvedValue(product as never);

    const { ankorstoreKickoffUpdate } = await import("@/lib/ankorstore-update");
    const result = await ankorstoreKickoffUpdate("product-1");

    expect(result.success).toBe(true);
    if (!result.success) return;
    // Le diff d'images n'est pas vide → une op asynchrone DOIT être créée
    expect(result.operationId).toBe("op-test");
    expect(mockCreateCatalogOperation).toHaveBeenCalledWith("update");
    expect(mockAddProductsToOperation).toHaveBeenCalled();
    expect(mockStartOperation).toHaveBeenCalled();

    // Et le payload envoyé à Ankorstore doit pointer vers la NOUVELLE image (Bleu)
    const addCall = mockAddProductsToOperation.mock.calls[0];
    const products = addCall[1] as { mainImage?: string }[];
    expect(products[0].mainImage).toContain("ref001-blue-1.webp");
  });

  it("Test 6: nouvelle variante locale (sans ankorsVariantId) → incluse dans le payload async avec SKU local", async () => {
    // Avant fix : la nouvelle variante était filtrée → AS ne la créait jamais.
    // Après fix : elle est envoyée à AS avec son SKU local, AS la crée,
    // finalize relance l'auto-link pour récupérer le nouveau ankorsVariantId.
    const prevSnapshot = makeSnapshot();
    const product = makeProduct({
      ankorsLastSyncSnapshot: prevSnapshot,
      colors: [
        // Couleur déjà liée (Rouge → ank-variant-1)
        {
          id: "variant-1",
          ankorsVariantId: "ank-variant-1",
          unitPrice: 10,
          weight: 0.5,
          stock: 10,
          isPrimary: true,
          saleType: "UNIT",
          packQuantity: null,
          sku: "REF001_red_UNIT_1",
          variantSizes: [],
          colorId: "color-1",
          color: { id: "color-1", name: "Rouge" },
          packLines: [],
          images: [],
        },
        // Nouvelle couleur ajoutée localement, pas encore sur AS
        {
          id: "variant-2",
          ankorsVariantId: null,
          unitPrice: 12,
          weight: 0.5,
          stock: 7,
          isPrimary: false,
          saleType: "UNIT",
          packQuantity: null,
          sku: null,
          variantSizes: [],
          colorId: "color-3",
          color: { id: "color-3", name: "Vert" },
          packLines: [],
          images: [],
        },
      ],
    });
    vi.mocked(prisma.product.findUnique).mockResolvedValue(product as never);
    // AS ne connaît que la variante existante → auto-link ne trouvera rien
    // pour la nouvelle (mock par défaut retourne matched=0,0).
    mockGetVariants.mockResolvedValueOnce([
      { id: "ank-variant-1", sku: "REF001_red_UNIT_1" },
    ]);

    const { ankorstoreKickoffUpdate } = await import("@/lib/ankorstore-update");
    const result = await ankorstoreKickoffUpdate("product-1");

    expect(result.success).toBe(true);
    if (!result.success) return;
    // Une op asynchrone DOIT être créée juste pour pousser la nouvelle variante
    expect(result.operationId).toBe("op-test");
    expect(mockCreateCatalogOperation).toHaveBeenCalledWith("update");

    // Le payload doit contenir LES DEUX variantes (la liée et la nouvelle)
    const addCall = mockAddProductsToOperation.mock.calls[0];
    const products = addCall[1] as { variants: { sku: string; options: { name: string; value: string }[] }[] }[];
    expect(products[0].variants).toHaveLength(2);
    const colors = products[0].variants
      .map((v) => v.options.find((o) => o.name === "color")?.value)
      .sort();
    expect(colors).toEqual(["Rouge", "Vert"]);
    // La nouvelle variante porte son SKU local (Ankorstore créera la variante)
    const newVariant = products[0].variants.find(
      (v) => v.options.find((o) => o.name === "color")?.value === "Vert",
    );
    expect(newVariant?.sku?.toLowerCase()).toContain("vert");
  });

  it("Test 7: variante supprimée localement → PATCH stock 0 (la seule action atomique fiable)", async () => {
    // Avant fix : le diff voyait "rien à patcher" (la variante supprimée
    // n'apparaissait nulle part), early return instant, AS gardait la variante.
    // Après fix : on détecte la variante supprimée, on PATCHe son stock à 0
    // sur AS (DELETE direct = 405, catalog-integration delete archive tout
    // le produit). Purge synchrone du snapshot.
    // Snapshot stocke le SKU lowercase (comme `buildVariantSku` le produit).
    const prevSnapshot = makeSnapshot({
      variants: {
        "ank-variant-1": {
          sku: "REF001_red_UNIT_1",
          wholesalePriceCents: 1000,
          retailPriceCents: 1000,
          stockQty: 10,
          isAlwaysInStock: false,
          optionColor: "Rouge",
          optionSize: "TU",
          optionMaterial: null,
        },
        "ank-variant-2": {
          sku: "REF001_blue_UNIT_2", // lowercase dans le snapshot
          wholesalePriceCents: 1000,
          retailPriceCents: 1000,
          stockQty: 5,
          isAlwaysInStock: false,
          optionColor: "Bleu",
          optionSize: "TU",
          optionMaterial: null,
        },
      },
    });

    // Local : seul Rouge subsiste, Bleu a été supprimé
    const product = makeProduct({
      ankorsLastSyncSnapshot: prevSnapshot,
      // colors par défaut = juste la variante Rouge
    });
    vi.mocked(prisma.product.findUnique).mockResolvedValue(product as never);
    // AS retourne le SKU en UPPERCASE (cas réel constaté en prod sur A405) —
    // c'est CE SKU que le DELETE doit envoyer pour que AS reconnaisse la variante.
    mockGetVariants.mockResolvedValueOnce([
      { id: "ank-variant-1", sku: "REF001_RED_UNIT_1" },
      { id: "ank-variant-2", sku: "REF001_BLUE_UNIT_2" },
    ]);

    const { ankorstoreKickoffUpdate } = await import("@/lib/ankorstore-update");
    const result = await ankorstoreKickoffUpdate("product-1");

    expect(result.success).toBe(true);
    if (!result.success) return;
    // PATCH stock 0 sur l'ankorsVariantId de la variante supprimée
    expect(mockPatchVariantStock).toHaveBeenCalledWith("ank-variant-2", {
      stockQuantity: 0,
      isAlwaysInStock: false,
    });
    // Synchrone → operationId null
    expect(result.operationId).toBe(null);
    // Pas d'op UPDATE catalogue créée
    expect(mockCreateCatalogOperation).not.toHaveBeenCalled();
    // Pas d'AnkorstoreOperation row (synchrone)
    expect(mockAnkorstoreOperationCreate).not.toHaveBeenCalled();
  });

  it("skipRevalidation: true → ne déclenche pas revalidateTag sur la branche synchrone", async () => {
    // Bug : le worker en arrière-plan (setInterval) appelait kickoffUpdate sans
    // skipRevalidation. Quand seules les PATCH stock/prix étaient nécessaires,
    // revalidateTag était appelé hors contexte de requête → Invariant: static
    // generation store missing in revalidateTag products.
    const prevSnapshot = makeSnapshot();
    const product = makeProduct({
      ankorsLastSyncSnapshot: prevSnapshot,
      colors: [
        {
          id: "variant-1",
          ankorsVariantId: "ank-variant-1",
          unitPrice: 10,
          weight: 0.5,
          stock: 5,
          isPrimary: true,
          saleType: "UNIT",
          packQuantity: null,
          sku: "REF001_red_UNIT_1",
          variantSizes: [],
          colorId: "color-1",
          color: { id: "color-1", name: "Rouge" },
          packLines: [],
          images: [],
        },
      ],
    });
    vi.mocked(prisma.product.findUnique).mockResolvedValue(product as never);

    const { ankorstoreKickoffUpdate } = await import("@/lib/ankorstore-update");
    const result = await ankorstoreKickoffUpdate("product-1", { skipRevalidation: true });

    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.operationId).toBe(null);
    // La PATCH stock a bien été envoyée (preuve qu'on est passé par la branche sync)
    expect(mockPatchVariantStock).toHaveBeenCalled();
    // Mais revalidateTag NE DOIT PAS avoir été appelé
    expect(mockRevalidateTag).not.toHaveBeenCalled();
  });

  it("skipRevalidation par défaut (false) → déclenche revalidateTag sur la branche synchrone", async () => {
    // Garde-fou : un appel depuis une server action (contexte de requête) doit
    // continuer à rafraîchir le cache produits.
    const prevSnapshot = makeSnapshot();
    const product = makeProduct({
      ankorsLastSyncSnapshot: prevSnapshot,
      colors: [
        {
          id: "variant-1",
          ankorsVariantId: "ank-variant-1",
          unitPrice: 10,
          weight: 0.5,
          stock: 5,
          isPrimary: true,
          saleType: "UNIT",
          packQuantity: null,
          sku: "REF001_red_UNIT_1",
          variantSizes: [],
          colorId: "color-1",
          color: { id: "color-1", name: "Rouge" },
          packLines: [],
          images: [],
        },
      ],
    });
    vi.mocked(prisma.product.findUnique).mockResolvedValue(product as never);

    const { ankorstoreKickoffUpdate } = await import("@/lib/ankorstore-update");
    const result = await ankorstoreKickoffUpdate("product-1");

    expect(result.success).toBe(true);
    expect(mockRevalidateTag).toHaveBeenCalledWith("products", "default");
  });

  it("Bonus: produit introuvable en base → retourne error", async () => {
    vi.mocked(prisma.product.findUnique).mockResolvedValue(null);

    const { ankorstoreKickoffUpdate } = await import("@/lib/ankorstore-update");
    const result = await ankorstoreKickoffUpdate("missing-product");

    expect(result).toEqual({ success: false, error: "Produit introuvable en base" });
    expect(mockCreateCatalogOperation).not.toHaveBeenCalled();
  });

  it("Stock 0 forcé quand product.status === 'OFFLINE' (PATCH stock + payload async)", async () => {
    // Sans snapshot précédent : le diff considère tout comme nouveau,
    // statusChanged = true → op async + PATCH stock individuels.
    // Le produit a stock=10 localement mais OFFLINE → on doit envoyer 0 à AS.
    const product = makeProduct({
      status: "OFFLINE",
      ankorsLastSyncSnapshot: null,
    });
    vi.mocked(prisma.product.findUnique).mockResolvedValue(product as never);

    const { ankorstoreKickoffUpdate } = await import("@/lib/ankorstore-update");
    const result = await ankorstoreKickoffUpdate("product-1");

    expect(result.success).toBe(true);

    // PATCH stock individuel : stockQuantity à 0 (pas 10)
    expect(mockPatchVariantStock).toHaveBeenCalledWith("ank-variant-1", {
      stockQuantity: 0,
      isAlwaysInStock: false,
    });

    // Payload async : variants[].stock_quantity à 0 aussi
    const addCall = mockAddProductsToOperation.mock.calls[0];
    const products = addCall[1] as { variants: { stockQuantity: number }[] }[];
    expect(products[0].variants[0].stockQuantity).toBe(0);
  });

  it("Stock 0 forcé quand product.status === 'ARCHIVED' (comportement préservé)", async () => {
    const product = makeProduct({
      status: "ARCHIVED",
      ankorsLastSyncSnapshot: null,
    });
    vi.mocked(prisma.product.findUnique).mockResolvedValue(product as never);

    const { ankorstoreKickoffUpdate } = await import("@/lib/ankorstore-update");
    const result = await ankorstoreKickoffUpdate("product-1");

    expect(result.success).toBe(true);
    expect(mockPatchVariantStock).toHaveBeenCalledWith("ank-variant-1", {
      stockQuantity: 0,
      isAlwaysInStock: false,
    });
    const addCall = mockAddProductsToOperation.mock.calls[0];
    const products = addCall[1] as { variants: { stockQuantity: number }[] }[];
    expect(products[0].variants[0].stockQuantity).toBe(0);
  });

  it("Stock réel envoyé quand product.status === 'ONLINE'", async () => {
    const product = makeProduct({
      status: "ONLINE",
      ankorsLastSyncSnapshot: null,
    });
    vi.mocked(prisma.product.findUnique).mockResolvedValue(product as never);

    const { ankorstoreKickoffUpdate } = await import("@/lib/ankorstore-update");
    const result = await ankorstoreKickoffUpdate("product-1");

    expect(result.success).toBe(true);
    expect(mockPatchVariantStock).toHaveBeenCalledWith("ank-variant-1", {
      stockQuantity: 10,
      isAlwaysInStock: false,
    });
    const addCall = mockAddProductsToOperation.mock.calls[0];
    const products = addCall[1] as { variants: { stockQuantity: number }[] }[];
    expect(products[0].variants[0].stockQuantity).toBe(10);
  });

  it("OFFLINE → ONLINE : repasser ONLINE restaure le vrai stock au prochain push", async () => {
    // Snapshot précédent : stock 0 (push OFFLINE précédent)
    const prevSnapshot = makeSnapshot({
      variants: {
        "ank-variant-1": {
          sku: "REF001_red_UNIT_1",
          wholesalePriceCents: 1000,
          retailPriceCents: 1000,
          stockQty: 0,
          isAlwaysInStock: false,
          optionColor: "Rouge",
          optionSize: "TU",
          optionMaterial: null,
        },
      },
      status: "inactive",
    });
    // Maintenant ONLINE avec stock 10 → diff doit voir le changement
    const product = makeProduct({
      status: "ONLINE",
      ankorsLastSyncSnapshot: prevSnapshot,
    });
    vi.mocked(prisma.product.findUnique).mockResolvedValue(product as never);

    const { ankorstoreKickoffUpdate } = await import("@/lib/ankorstore-update");
    const result = await ankorstoreKickoffUpdate("product-1");

    expect(result.success).toBe(true);
    // Le vrai stock (10) doit repartir vers AS
    expect(mockPatchVariantStock).toHaveBeenCalledWith("ank-variant-1", {
      stockQuantity: 10,
      isAlwaysInStock: false,
    });
  });
});
