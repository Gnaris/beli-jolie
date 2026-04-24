import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * Phase "Correspondance" de l'import PFS : le scan doit remonter assez
 * d'infos pour que le modal de création puisse pré-remplir (et verrouiller)
 * les 3 champs de la catégorie PFS ainsi que le code hex de la couleur.
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

vi.mock("@/lib/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

import { scanPfsAttributes } from "@/lib/pfs-import";

function mkPfsProduct(overrides: Record<string, unknown> = {}) {
  return {
    id: "pfs-1",
    reference: "REF-1",
    family: "Bijoux_Fantaisie",
    category: { id: "cat-pfs-1", labels: { fr: "Bagues", en: "Rings" } },
    labels: { fr: "Bague dorée" },
    images: {},
    colors: "Doré",
    count_variants: 1,
    sizes: "M",
    variants: [
      {
        id: "v-1",
        type: "ITEM",
        item: {
          color: {
            id: 1,
            reference: "GOLDEN",
            value: "#D4AF37",
            image: null,
            labels: { fr: "Doré", en: "Golden" },
          },
          size: "M",
        },
      },
    ],
    ...overrides,
  };
}

describe("scanPfsAttributes — meta pour la phase Correspondance", () => {
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
  });

  it("renseigne genre + famille + sous-catégorie brute (libellé PFS tel quel)", async () => {
    pfsListProductsSpy.mockResolvedValue({
      data: [mkPfsProduct()],
      meta: { last_page: 1 },
    });

    const result = await scanPfsAttributes();
    const cat = result.attributes.find((a) => a.type === "category");
    expect(cat).toBeDefined();
    expect(cat?.meta?.pfsGender).toBe("WOMAN");
    expect(cat?.meta?.pfsFamilyName).toBe("Bijoux_Fantaisie");
    expect(cat?.meta?.pfsCategoryName).toBe("Bagues");
  });

  it("conserve le libellé PFS même quand il n'est pas dans le référentiel statique", async () => {
    pfsListProductsSpy.mockResolvedValue({
      data: [
        mkPfsProduct({
          category: { id: "cat-exotic", labels: { fr: "Catégorie exotique" } },
        }),
      ],
      meta: { last_page: 1 },
    });

    const result = await scanPfsAttributes();
    const cat = result.attributes.find((a) => a.type === "category");
    expect(cat?.meta?.pfsCategoryName).toBe("Catégorie exotique");
    expect(cat?.meta?.pfsFamilyName).toBe("Bijoux_Fantaisie");
    expect(cat?.meta?.pfsGender).toBe("WOMAN");
  });

  it("remonte le code hex PFS dans meta pour le type couleur", async () => {
    pfsListProductsSpy.mockResolvedValue({
      data: [mkPfsProduct()],
      meta: { last_page: 1 },
    });

    const result = await scanPfsAttributes();
    const color = result.attributes.find((a) => a.type === "color");
    expect(color).toBeDefined();
    expect(color?.pfsRef).toBe("GOLDEN");
    expect(color?.meta?.hex).toBe("#D4AF37");
  });

  it("conserve genre + famille même quand PFS ne fournit pas de category.id", async () => {
    pfsListProductsSpy.mockResolvedValue({
      data: [
        mkPfsProduct({
          // Produit sans sous-catégorie PFS (cas des produits old-school)
          category: undefined,
          family: "Bijoux_Fantaisie",
        }),
      ],
      meta: { last_page: 1 },
    });

    const result = await scanPfsAttributes();
    const cat = result.attributes.find((a) => a.type === "category");
    expect(cat).toBeDefined();
    expect(cat?.meta?.pfsGender).toBe("WOMAN");
    expect(cat?.meta?.pfsFamilyName).toBe("Bijoux_Fantaisie");
    // Pas de sous-catégorie quand PFS n'en fournit pas — le verrou affichera « — »
    expect(cat?.meta?.pfsCategoryName).toBeNull();
  });

  it("utilise le libellé officiel du référentiel /catalog/attributes/categories quand prod.category.labels est vide", async () => {
    pfsListProductsSpy.mockResolvedValue({
      data: [
        mkPfsProduct({
          category: { id: "cat-pfs-1", labels: {} },
        }),
      ],
      meta: { last_page: 1 },
    });
    pfsGetCategoriesSpy.mockResolvedValue([
      { id: "cat-pfs-1", labels: { fr: "Bagues" }, gender: "WOMAN", family: { id: "fam-1" } },
    ]);

    const result = await scanPfsAttributes();
    const cat = result.attributes.find((a) => a.type === "category");
    expect(cat?.meta?.pfsCategoryName).toBe("Bagues");
    expect(cat?.label).toBe("Bagues");
  });

  it("déduit le genre depuis le référentiel officiel quand la famille n'est pas dans la table statique", async () => {
    pfsListProductsSpy.mockResolvedValue({
      data: [
        mkPfsProduct({
          family: "Famille_Inconnue",
          category: { id: "cat-new", labels: { fr: "Nouveauté" } },
        }),
      ],
      meta: { last_page: 1 },
    });
    pfsGetCategoriesSpy.mockResolvedValue([
      { id: "cat-new", labels: { fr: "Nouveauté" }, gender: "MAN", family: "Famille_Inconnue" },
    ]);

    const result = await scanPfsAttributes();
    const cat = result.attributes.find((a) => a.type === "category");
    expect(cat?.meta?.pfsGender).toBe("MAN");
  });

  it("normalise le genre brut venant de PFS (ex: 'Femme' → 'WOMAN')", async () => {
    pfsListProductsSpy.mockResolvedValue({
      data: [
        mkPfsProduct({
          gender: "Femme",
          family: "Famille_Inconnue",
          category: { id: "cat-x", labels: { fr: "Truc" } },
        }),
      ],
      meta: { last_page: 1 },
    });
    pfsGetCategoriesSpy.mockResolvedValue([]);

    const result = await scanPfsAttributes();
    const cat = result.attributes.find((a) => a.type === "category");
    expect(cat?.meta?.pfsGender).toBe("WOMAN");
  });

  it("ne retombe JAMAIS sur l'id PFS comme libellé de catégorie", async () => {
    pfsListProductsSpy.mockResolvedValue({
      data: [
        mkPfsProduct({
          category: { id: "cat-abc123", labels: {} },
          family: "Bijoux_Fantaisie",
        }),
      ],
      meta: { last_page: 1 },
    });
    pfsGetCategoriesSpy.mockResolvedValue([]);

    const result = await scanPfsAttributes();
    const cat = result.attributes.find((a) => a.type === "category");
    expect(cat?.meta?.pfsCategoryName).toBeNull();
    // La table scan affiche la famille en repli, jamais l'id
    expect(cat?.label).not.toBe("cat-abc123");
    expect(cat?.label).toBe("Bijoux_Fantaisie");
  });

  it("renvoie hex = null quand PFS ne fournit pas de code couleur", async () => {
    pfsListProductsSpy.mockResolvedValue({
      data: [
        mkPfsProduct({
          variants: [
            {
              id: "v-2",
              type: "ITEM",
              item: {
                color: {
                  id: 2,
                  reference: "NOIR",
                  value: "",
                  image: null,
                  labels: { fr: "Noir" },
                },
                size: "M",
              },
            },
          ],
        }),
      ],
      meta: { last_page: 1 },
    });

    const result = await scanPfsAttributes();
    const color = result.attributes.find((a) => a.type === "color");
    expect(color?.meta?.hex).toBeNull();
  });
});
