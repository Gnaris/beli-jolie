import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * Bug : pour certains produits PFS (ex: ref 1759), `prod.family` est un
 * identifiant Salesforce brut (ex: "a035J00000185J7QAI") qui n'est pas
 * forcément résolu par `pfsGetFamilies()`. Avant le fix on enregistrait
 * l'identifiant tel quel dans `pfsFamilyName` — ce qui s'affichait dans la
 * modale de correspondance et restait dans la BDD.
 *
 * Ce fichier vérifie :
 *  1. Le helper `sanitizePfsFamilyName` rejette les IDs bruts.
 *  2. Le helper `inferPfsFamilyFromCategoryLabel` retrouve la famille
 *     depuis le libellé de la sous-catégorie ("Bagues" → "Bijoux_Fantaisie").
 *  3. Le scan utilise ce filet de sécurité quand pfsGetFamilies échoue.
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
  pfsGetFamiliesSpy,
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
  pfsGetFamiliesSpy: vi.fn(),
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
  pfsGetFamilies: pfsGetFamiliesSpy,
}));

vi.mock("@/lib/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

import {
  scanPfsAttributes,
  sanitizePfsFamilyName,
  inferPfsFamilyFromCategoryLabel,
} from "@/lib/pfs-import";

describe("sanitizePfsFamilyName", () => {
  it("garde un nom de famille connu de la taxonomie", () => {
    expect(sanitizePfsFamilyName("Bijoux_Fantaisie")).toBe("Bijoux_Fantaisie");
    expect(sanitizePfsFamilyName("Vêtements")).toBe("Vêtements");
    expect(sanitizePfsFamilyName("Accessoires_H")).toBe("Accessoires_H");
  });

  it("retourne null pour un identifiant Salesforce brut", () => {
    expect(sanitizePfsFamilyName("a035J00000185J7QAI")).toBeNull();
    expect(sanitizePfsFamilyName("a08gK00001ABC123XYZ")).toBeNull();
  });

  it("retourne null pour vide / null / espaces", () => {
    expect(sanitizePfsFamilyName(null)).toBeNull();
    expect(sanitizePfsFamilyName(undefined)).toBeNull();
    expect(sanitizePfsFamilyName("")).toBeNull();
    expect(sanitizePfsFamilyName("   ")).toBeNull();
  });

  it("retourne null pour un nom inconnu (pas dans la taxonomie)", () => {
    expect(sanitizePfsFamilyName("Famille_Inventee")).toBeNull();
  });

  it("trim les espaces avant validation", () => {
    expect(sanitizePfsFamilyName("  Bijoux_Fantaisie  ")).toBe("Bijoux_Fantaisie");
  });
});

describe("inferPfsFamilyFromCategoryLabel", () => {
  it("retrouve la famille depuis une sous-catégorie connue", () => {
    // "Bagues" et "Colliers" existent dans plusieurs familles, mais
    // Bijoux_Fantaisie est insérée en premier — c'est ce qui sort.
    expect(inferPfsFamilyFromCategoryLabel("Bagues")).toBe("Bijoux_Fantaisie");
    expect(inferPfsFamilyFromCategoryLabel("Colliers")).toBe("Bijoux_Fantaisie");
    // "Maillots de bain" n'est défini QUE dans Lingerie → unique.
    expect(inferPfsFamilyFromCategoryLabel("Maillots de bain")).toBe("Lingerie");
    // "Abayas" n'apparaît QUE dans Vêtements → unique.
    expect(inferPfsFamilyFromCategoryLabel("Abayas")).toBe("Vêtements");
  });

  it("retourne null pour un libellé inconnu", () => {
    expect(inferPfsFamilyFromCategoryLabel("Pas Une Catégorie")).toBeNull();
  });

  it("retourne null pour vide / null", () => {
    expect(inferPfsFamilyFromCategoryLabel(null)).toBeNull();
    expect(inferPfsFamilyFromCategoryLabel(undefined)).toBeNull();
    expect(inferPfsFamilyFromCategoryLabel("")).toBeNull();
    expect(inferPfsFamilyFromCategoryLabel("   ")).toBeNull();
  });

  it("trim les espaces avant recherche", () => {
    expect(inferPfsFamilyFromCategoryLabel("  Bagues  ")).toBe("Bijoux_Fantaisie");
  });
});

describe("scanPfsAttributes — résolution famille robuste (ref 1759)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockProductFindMany.mockResolvedValue([]);
    mockCategoryFindMany.mockResolvedValue([]);
    mockColorFindMany.mockResolvedValue([]);
    mockSizeFindMany.mockResolvedValue([]);
    mockCompositionFindMany.mockResolvedValue([]);
    mockCountryFindMany.mockResolvedValue([]);
    mockSeasonFindMany.mockResolvedValue([]);
    pfsCheckReferenceSpy.mockResolvedValue({ product: null });
    pfsGetCategoriesSpy.mockResolvedValue([]);
    pfsGetFamiliesSpy.mockResolvedValue([]);
  });

  function mkProductRef1759(overrides: Record<string, unknown> = {}) {
    return {
      id: "pfs-1759",
      reference: "1759",
      // Identifiant Salesforce brut renvoyé par PFS — c'est le cas qui
      // déclenchait le bug d'affichage.
      family: "a035J00000185J7QAI",
      gender: "WOMAN",
      category: { id: "cat-pfs-bagues", labels: { fr: "Bagues" } },
      labels: { fr: "Bague test" },
      images: {},
      colors: "Doré",
      count_variants: 1,
      sizes: "TU",
      variants: [
        {
          id: "v-1",
          type: "ITEM",
          item: {
            color: { id: 1, reference: "GOLDEN", value: "#D4AF37", image: null, labels: { fr: "Doré" } },
            size: "TU",
          },
        },
      ],
      ...overrides,
    };
  }

  it("résout la famille via le libellé de catégorie quand pfsGetFamilies échoue", async () => {
    pfsListProductsSpy.mockResolvedValue({
      data: [mkProductRef1759()],
      meta: { last_page: 1 },
    });
    // Le call à pfsGetFamilies plante (réseau, auth, etc.)
    pfsGetFamiliesSpy.mockRejectedValue(new Error("network"));

    const result = await scanPfsAttributes();
    const cat = result.attributes.find((a) => a.type === "category");
    expect(cat).toBeDefined();
    // Le filet de sécurité retrouve "Bijoux_Fantaisie" depuis "Bagues"
    expect(cat?.meta?.pfsFamilyName).toBe("Bijoux_Fantaisie");
    // Surtout pas l'ID brut Salesforce
    expect(cat?.meta?.pfsFamilyName).not.toBe("a035J00000185J7QAI");
    expect(cat?.meta?.pfsCategoryName).toBe("Bagues");
    expect(cat?.meta?.pfsGender).toBe("WOMAN");
  });

  it("résout la famille via le référentiel API quand il est disponible", async () => {
    pfsListProductsSpy.mockResolvedValue({
      data: [mkProductRef1759()],
      meta: { last_page: 1 },
    });
    pfsGetFamiliesSpy.mockResolvedValue([
      { id: "a035J00000185J7QAI", labels: { fr: "Bijoux Fantaisie" }, gender: "WOMAN" },
    ]);

    const result = await scanPfsAttributes();
    const cat = result.attributes.find((a) => a.type === "category");
    // Le label avec espaces est converti en underscores (taxonomie locale)
    expect(cat?.meta?.pfsFamilyName).toBe("Bijoux_Fantaisie");
  });

  it("ne propage JAMAIS un identifiant Salesforce brut dans pfsFamilyName", async () => {
    pfsListProductsSpy.mockResolvedValue({
      data: [
        mkProductRef1759({
          // Sous-catégorie inconnue → pas de filet via le label
          category: { id: "cat-x", labels: { fr: "Catégorie Mystère" } },
        }),
      ],
      meta: { last_page: 1 },
    });
    pfsGetFamiliesSpy.mockRejectedValue(new Error("network"));

    const result = await scanPfsAttributes();
    const cat = result.attributes.find((a) => a.type === "category");
    // Aucun moyen de résoudre → null (mieux que l'ID brut)
    expect(cat?.meta?.pfsFamilyName).toBeNull();
  });

  it("garde la famille propre quand prod.family est déjà un nom de la taxonomie", async () => {
    pfsListProductsSpy.mockResolvedValue({
      data: [
        mkProductRef1759({
          family: "Bijoux_Fantaisie",
          category: { id: "cat-x", labels: { fr: "Catégorie Mystère" } },
        }),
      ],
      meta: { last_page: 1 },
    });
    pfsGetFamiliesSpy.mockResolvedValue([]);

    const result = await scanPfsAttributes();
    const cat = result.attributes.find((a) => a.type === "category");
    expect(cat?.meta?.pfsFamilyName).toBe("Bijoux_Fantaisie");
  });
});
