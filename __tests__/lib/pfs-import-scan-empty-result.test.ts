import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * Cas où tous les produits PFS de la marque sont déjà dans la BDD locale :
 * `filterImportable` retourne `[]`, donc `scanPfsAttributes` doit renvoyer
 * `attributes: []` + compteurs à 0. Ce contrat sert à l'UI ("Aucun nouveau
 * produit à importer") qui se base sur `scanMeta !== null` pour détecter un
 * scan terminé, et sur `attributes.length === 0` pour afficher le panneau
 * d'information.
 */

const {
  mockCategoryFindMany,
  mockColorFindMany,
  mockSizeFindMany,
  mockCompositionFindMany,
  mockCountryFindMany,
  mockSeasonFindMany,
  mockProductFindMany,
  pfsListProductsSpy,
  pfsCheckReferenceSpy,
  pfsGetCategoriesSpy,
} = vi.hoisted(() => ({
  mockCategoryFindMany: vi.fn(),
  mockColorFindMany: vi.fn(),
  mockSizeFindMany: vi.fn(),
  mockCompositionFindMany: vi.fn(),
  mockCountryFindMany: vi.fn(),
  mockSeasonFindMany: vi.fn(),
  mockProductFindMany: vi.fn(),
  pfsListProductsSpy: vi.fn(),
  pfsCheckReferenceSpy: vi.fn(),
  pfsGetCategoriesSpy: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    category: { findMany: mockCategoryFindMany },
    color: { findMany: mockColorFindMany },
    size: { findMany: mockSizeFindMany },
    composition: { findMany: mockCompositionFindMany },
    manufacturingCountry: { findMany: mockCountryFindMany },
    season: { findMany: mockSeasonFindMany },
    product: { findMany: mockProductFindMany },
  },
}));

vi.mock("@/lib/pfs-api", async () => {
  const actual = await vi.importActual<typeof import("@/lib/pfs-api")>("@/lib/pfs-api");
  return {
    ...actual,
    pfsListProducts: pfsListProductsSpy,
    pfsCheckReference: pfsCheckReferenceSpy,
    pfsGetVariants: vi.fn(),
  };
});

vi.mock("@/lib/pfs-api-write", () => ({
  pfsGetCategories: pfsGetCategoriesSpy,
}));

vi.mock("@/lib/pfs-brand", () => ({
  requirePfsBrand: vi.fn().mockResolvedValue({ id: "BRAND-1", name: "Beli & Jolie" }),
  PfsBrandRequiredError: class PfsBrandRequiredError extends Error {},
}));

vi.mock("@/lib/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

import { scanPfsAttributes } from "@/lib/pfs-import";

describe("scanPfsAttributes — résultat vide en mode browse", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockCategoryFindMany.mockResolvedValue([]);
    mockColorFindMany.mockResolvedValue([]);
    mockSizeFindMany.mockResolvedValue([]);
    mockCompositionFindMany.mockResolvedValue([]);
    mockCountryFindMany.mockResolvedValue([]);
    mockSeasonFindMany.mockResolvedValue([]);
    pfsCheckReferenceSpy.mockResolvedValue({ product: null });
    pfsGetCategoriesSpy.mockResolvedValue([]);
  });

  it("retourne attributes=[] et compteurs=0 quand tous les produits PFS sont déjà en BDD", async () => {
    // PFS expose 2 produits, MAIS les 2 sont déjà dans la BDD locale.
    pfsListProductsSpy.mockResolvedValue({
      data: [
        { id: "p-1", reference: "REF-1", family: "Bijoux_Fantaisie", category: { id: "c-1", labels: { fr: "Bagues" } }, variants: [], sizes: "" },
        { id: "p-2", reference: "REF-2", family: "Bijoux_Fantaisie", category: { id: "c-1", labels: { fr: "Bagues" } }, variants: [], sizes: "" },
      ],
      meta: { last_page: 1 },
    });
    mockProductFindMany.mockResolvedValue([
      { reference: "REF-1" },
      { reference: "REF-2" },
    ]);

    const result = await scanPfsAttributes();

    expect(result.attributes).toEqual([]);
    expect(result.scannedProducts).toBe(0);
    expect(result.deepScannedProducts).toBe(0);
  });

  it("ne plante pas si PFS renvoie zéro produit du tout", async () => {
    pfsListProductsSpy.mockResolvedValue({
      data: [],
      meta: { last_page: 1 },
    });
    mockProductFindMany.mockResolvedValue([]);

    const result = await scanPfsAttributes();

    expect(result.attributes).toEqual([]);
    expect(result.scannedProducts).toBe(0);
    expect(result.deepScannedProducts).toBe(0);
  });
});
