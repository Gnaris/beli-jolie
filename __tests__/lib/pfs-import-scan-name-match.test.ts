import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * Phase "Correspondance" — résolution étendue des attributs déjà présents.
 *
 * Le scan PFS doit considérer un attribut comme « déjà mappé » si l'entité
 * existe dans la bibliothèque par référence PFS *ou* par nom équivalent.
 * Évite que le scan propose de re-créer une couleur/taille/composition/pays
 * /saison qui existe déjà chez nous sous un nom équivalent (cas typique :
 * couleur créée à la main avant l'arrivée de PFS, ou créée par un ancien
 * scan qui ne renseignait pas encore `pfsColorRef`).
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
  pfsGetFamilies: vi.fn().mockResolvedValue([]),
}));

vi.mock("@/lib/pfs-brand", () => ({
  requirePfsBrand: vi.fn().mockResolvedValue({ id: "BRAND-1", name: "Beli & Jolie" }),
  PfsBrandRequiredError: class PfsBrandRequiredError extends Error {},
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

describe("scanPfsAttributes — match par nom OU référence PFS", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockProductFindMany.mockResolvedValue([]);
    mockCategoryFindMany.mockResolvedValue([]);
    mockColorFindMany.mockResolvedValue([]);
    mockSizeFindMany.mockResolvedValue([]);
    mockCompositionFindMany.mockResolvedValue([]);
    mockCountryFindMany.mockResolvedValue([]);
    mockSeasonFindMany.mockResolvedValue([]);
    pfsCheckReferenceSpy.mockResolvedValue({
      product: {
        material_composition: [
          { reference: "ACIERINOXYDABLE", labels: { fr: "Acier inoxydable" } },
        ],
        country_of_manufacture: "CN",
        collection: { reference: "PE2026", labels: { fr: "Printemps/Été 2026" } },
      },
    });
    pfsGetCategoriesSpy.mockResolvedValue([]);
    pfsListProductsSpy.mockResolvedValue({
      data: [mkPfsProduct()],
      meta: { last_page: 1 },
    });
  });

  it("considère une couleur comme mappée quand le nom local correspond au libellé PFS, même sans pfsColorRef", async () => {
    mockColorFindMany.mockResolvedValue([
      { id: "col-existing", name: "Doré", pfsColorRef: null },
    ]);

    const result = await scanPfsAttributes();
    const color = result.attributes.find((a) => a.type === "color");
    expect(color?.mapped).toBe(true);
    expect(color?.localId).toBe("col-existing");
    expect(color?.localName).toBe("Doré");
  });

  it("considère une couleur comme mappée quand pfsColorRef matche, même si le nom diffère", async () => {
    mockColorFindMany.mockResolvedValue([
      { id: "col-renamed", name: "Or jaune", pfsColorRef: "GOLDEN" },
    ]);

    const result = await scanPfsAttributes();
    const color = result.attributes.find((a) => a.type === "color");
    expect(color?.mapped).toBe(true);
    expect(color?.localId).toBe("col-renamed");
    expect(color?.localName).toBe("Or jaune");
  });

  it("la requête couleur cherche par pfsColorRef OU par nom (libellé)", async () => {
    await scanPfsAttributes();
    expect(mockColorFindMany).toHaveBeenCalledWith({
      where: {
        OR: [
          { pfsColorRef: { in: ["GOLDEN"] } },
          { name: { in: ["Doré"] } },
        ],
      },
      select: { id: true, name: true, pfsColorRef: true },
    });
  });

  it("la comparaison par nom est insensible à la casse (FR)", async () => {
    mockColorFindMany.mockResolvedValue([
      { id: "col-lower", name: "doré", pfsColorRef: null },
    ]);

    const result = await scanPfsAttributes();
    const color = result.attributes.find((a) => a.type === "color");
    expect(color?.mapped).toBe(true);
    expect(color?.localId).toBe("col-lower");
  });

  it("considère une taille comme mappée par nom même sans pfsSizeRef", async () => {
    mockSizeFindMany.mockResolvedValue([
      { id: "sz-existing", name: "M", pfsSizeRef: null },
    ]);

    const result = await scanPfsAttributes();
    const size = result.attributes.find((a) => a.type === "size");
    expect(size?.mapped).toBe(true);
    expect(size?.localId).toBe("sz-existing");
  });

  it("considère une composition comme mappée par nom même sans pfsCompositionRef", async () => {
    mockCompositionFindMany.mockResolvedValue([
      { id: "cp-existing", name: "Acier inoxydable", pfsCompositionRef: null },
    ]);

    const result = await scanPfsAttributes();
    const comp = result.attributes.find((a) => a.type === "composition");
    expect(comp?.mapped).toBe(true);
    expect(comp?.localId).toBe("cp-existing");
  });

  it("considère un pays comme mappé par nom même sans pfsCountryRef", async () => {
    mockCountryFindMany.mockResolvedValue([
      { id: "ctry-existing", name: "Chine", pfsCountryRef: null },
    ]);

    const result = await scanPfsAttributes();
    const country = result.attributes.find((a) => a.type === "country");
    expect(country?.mapped).toBe(true);
    expect(country?.localId).toBe("ctry-existing");
  });

  it("considère une saison comme mappée par nom même sans pfsRef", async () => {
    mockSeasonFindMany.mockResolvedValue([
      { id: "sea-existing", name: "Printemps/Été 2026", pfsRef: null },
    ]);

    const result = await scanPfsAttributes();
    const season = result.attributes.find((a) => a.type === "season");
    expect(season?.mapped).toBe(true);
    expect(season?.localId).toBe("sea-existing");
  });

  it("propose de créer quand ni la référence ni le nom ne sont présents", async () => {
    mockColorFindMany.mockResolvedValue([
      { id: "col-other", name: "Argenté", pfsColorRef: "SILVER" },
    ]);

    const result = await scanPfsAttributes();
    const color = result.attributes.find((a) => a.type === "color");
    expect(color?.mapped).toBe(false);
    expect(color?.localId).toBeUndefined();
  });
});
