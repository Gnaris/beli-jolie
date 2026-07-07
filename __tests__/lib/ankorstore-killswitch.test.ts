/**
 * Tests pour le kill switch Ankorstore (bug 7).
 *
 * Quand la marketplace Ankorstore est désactivée dans Paramètres, les 3
 * fonctions de kickoff (Publish / Update / Refresh) doivent refuser d'appeler
 * l'API et retourner une erreur explicite — même si l'appelant contourne
 * le worker de la file d'attente.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

vi.mock("next/cache", () => ({
  revalidateTag: vi.fn(),
  unstable_cache: <T extends (...args: never[]) => unknown>(fn: T) => fn,
}));
vi.mock("@/lib/product-events", () => ({ emitProductEvent: vi.fn() }));

// APIs — aucune ne devrait être appelée si kill switch OFF
const mockCreateCatalogOperation = vi.fn();
const mockAddProductsToOperation = vi.fn();
const mockStartOperation = vi.fn();
const mockKickoffDelete = vi.fn();
const mockPatchVariantStock = vi.fn();
const mockPatchVariantPrices = vi.fn();

vi.mock("@/lib/ankorstore-api-write", () => ({
  ankorstoreCreateCatalogOperation: (...args: unknown[]) => mockCreateCatalogOperation(...args),
  ankorstoreAddProductsToOperation: (...args: unknown[]) => mockAddProductsToOperation(...args),
  ankorstoreStartOperation: (...args: unknown[]) => mockStartOperation(...args),
  ankorstoreKickoffDelete: (...args: unknown[]) => mockKickoffDelete(...args),
  ankorstoreLookupProductIdBySku: vi.fn(),
  ankorstorePatchVariantStock: (...args: unknown[]) => mockPatchVariantStock(...args),
  ankorstorePatchVariantPrices: (...args: unknown[]) => mockPatchVariantPrices(...args),
}));

vi.mock("@/lib/ankorstore-api", () => ({
  ankorstoreGetProduct: vi.fn(),
  ankorstoreGetVariants: vi.fn().mockResolvedValue([]),
}));

vi.mock("@/lib/ankorstore-description", () => ({
  formatAnkorstoreDescription: vi.fn().mockReturnValue("desc"),
  formatAnkorstoreCompositionLabel: vi.fn().mockReturnValue(null),
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

const mockProductFindUnique = vi.fn();

vi.mock("@/lib/prisma", () => ({
  prisma: {
    product: {
      findUnique: (...args: unknown[]) => mockProductFindUnique(...args),
      update: vi.fn(),
    },
    companyInfo: {
      findFirst: vi.fn().mockResolvedValue({ shopName: "Test" }),
    },
    productColor: { update: vi.fn(), updateMany: vi.fn() },
    ankorstoreOperation: {
      create: vi.fn(),
      findFirst: vi.fn().mockResolvedValue(null),
      updateMany: vi.fn().mockResolvedValue({ count: 0 }),
    },
    $transaction: vi.fn().mockResolvedValue([]),
  },
}));

const mockAnkorstoreEnabled = vi.fn();
vi.mock("@/lib/cached-data", () => ({
  getCachedAnkorstoreEnabled: () => mockAnkorstoreEnabled(),
}));

beforeEach(() => {
  vi.clearAllMocks();
});

describe("Kill switch Ankorstore (bug 7)", () => {
  it("ankorstoreKickoffPublish refuse quand la marketplace est désactivée", async () => {
    mockAnkorstoreEnabled.mockResolvedValue(false);

    const { ankorstoreKickoffPublish } = await import("@/lib/ankorstore-publish");
    const result = await ankorstoreKickoffPublish("p1");

    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.error).toMatch(/désactivée/i);

    // Aucun appel API ne doit passer
    expect(mockCreateCatalogOperation).not.toHaveBeenCalled();
    expect(mockAddProductsToOperation).not.toHaveBeenCalled();
    expect(mockStartOperation).not.toHaveBeenCalled();
    // Ne devrait même pas lire le produit
    expect(mockProductFindUnique).not.toHaveBeenCalled();
  });

  it("ankorstoreKickoffUpdate refuse quand la marketplace est désactivée (couvre les PATCH synchrones)", async () => {
    mockAnkorstoreEnabled.mockResolvedValue(false);

    const { ankorstoreKickoffUpdate } = await import("@/lib/ankorstore-update");
    const result = await ankorstoreKickoffUpdate("p1");

    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.error).toMatch(/désactivée/i);

    expect(mockPatchVariantStock).not.toHaveBeenCalled();
    expect(mockPatchVariantPrices).not.toHaveBeenCalled();
    expect(mockCreateCatalogOperation).not.toHaveBeenCalled();
  });

  it("ankorstoreKickoffRefresh refuse quand la marketplace est désactivée", async () => {
    mockAnkorstoreEnabled.mockResolvedValue(false);

    const { ankorstoreKickoffRefresh } = await import("@/lib/ankorstore-refresh");
    const result = await ankorstoreKickoffRefresh("p1");

    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.error).toMatch(/désactivée/i);

    expect(mockKickoffDelete).not.toHaveBeenCalled();
  });
});
