import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * Bug : PFS expose parfois deux catégories portant le même libellé
 * (ex : "Robes") mais avec deux IDs distincts — typiquement un ancien ID
 * obsolète encore attaché à de vieux produits du catalogue, et un nouvel ID
 * actif visible dans le référentiel `pfsGetCategories()`.
 *
 * Fix attendu : au scan, on dédoublonne par libellé en privilégiant l'ID
 * encore présent dans le référentiel officiel PFS. L'ID absent du référentiel
 * = obsolète, on l'écarte du listing renvoyé à l'admin.
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

vi.mock("@/lib/pfs-brand", () => ({
  requirePfsBrand: vi.fn().mockResolvedValue({ id: "BRAND-1", name: "Beli & Jolie" }),
  PfsBrandRequiredError: class PfsBrandRequiredError extends Error {},
}));

vi.mock("@/lib/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

import { scanPfsAttributes } from "@/lib/pfs-import";

function mkProduct(opts: { ref: string; categoryId: string; categoryFr: string }) {
  return {
    id: `pfs-${opts.ref}`,
    reference: opts.ref,
    family: "Pret-A-Porter",
    category: { id: opts.categoryId, labels: { fr: opts.categoryFr, en: "Dress" } },
    labels: { fr: opts.categoryFr },
    images: {},
    colors: "Noir",
    count_variants: 1,
    sizes: "M",
    variants: [
      {
        id: `v-${opts.ref}`,
        type: "ITEM",
        item: {
          color: { id: 1, reference: "BLACK", value: "#000000", image: null, labels: { fr: "Noir" } },
          size: "M",
        },
      },
    ],
  };
}

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
  pfsGetFamiliesSpy.mockResolvedValue([]);
});

describe("scanPfsAttributes — dédoublonnage catégorie via le référentiel officiel", () => {
  it("écarte l'ID obsolète quand un autre ID actif partage le même libellé", async () => {
    // Référentiel officiel PFS : seul ID_NEW est encore listé
    pfsGetCategoriesSpy.mockResolvedValue([
      { id: "ID_NEW", labels: { fr: "Robes", en: "Dresses" }, gender: "WOMAN" },
    ]);
    // Catalogue : 2 produits, l'un sur l'ID nouveau, l'autre sur l'ID obsolète
    pfsListProductsSpy.mockResolvedValue({
      data: [
        mkProduct({ ref: "A1", categoryId: "ID_NEW", categoryFr: "Robes" }),
        mkProduct({ ref: "A2", categoryId: "ID_OLD", categoryFr: "Robes" }),
      ],
      meta: { last_page: 1 },
    });

    const result = await scanPfsAttributes();
    const categoryAttrs = result.attributes.filter((a) => a.type === "category");
    expect(categoryAttrs).toHaveLength(1);
    expect(categoryAttrs[0].pfsRef).toBe("ID_NEW");
  });

  it("préserve les deux IDs si tous les deux figurent dans le référentiel officiel", async () => {
    pfsGetCategoriesSpy.mockResolvedValue([
      { id: "ID_A", labels: { fr: "Robes", en: "Dresses" }, gender: "WOMAN" },
      { id: "ID_B", labels: { fr: "Robes", en: "Dresses" }, gender: "WOMAN" },
    ]);
    pfsListProductsSpy.mockResolvedValue({
      data: [
        mkProduct({ ref: "A1", categoryId: "ID_A", categoryFr: "Robes" }),
        mkProduct({ ref: "A2", categoryId: "ID_B", categoryFr: "Robes" }),
      ],
      meta: { last_page: 1 },
    });

    const result = await scanPfsAttributes();
    const categoryAttrs = result.attributes.filter((a) => a.type === "category");
    // Indéterminable côté API → on garde la 1re rencontrée (pas de blocage)
    expect(categoryAttrs).toHaveLength(1);
    expect(["ID_A", "ID_B"]).toContain(categoryAttrs[0].pfsRef);
  });

  it("garde la 1re rencontrée si aucun des deux IDs n'est dans le référentiel", async () => {
    pfsGetCategoriesSpy.mockResolvedValue([]);
    pfsListProductsSpy.mockResolvedValue({
      data: [
        mkProduct({ ref: "A1", categoryId: "ID_X", categoryFr: "Robes" }),
        mkProduct({ ref: "A2", categoryId: "ID_Y", categoryFr: "Robes" }),
      ],
      meta: { last_page: 1 },
    });

    const result = await scanPfsAttributes();
    const categoryAttrs = result.attributes.filter((a) => a.type === "category");
    expect(categoryAttrs).toHaveLength(1);
    expect(categoryAttrs[0].pfsRef).toBe("ID_X");
  });

  it("ne dédoublonne pas deux catégories de libellés différents", async () => {
    pfsGetCategoriesSpy.mockResolvedValue([
      { id: "ID_ROBES", labels: { fr: "Robes", en: "Dresses" }, gender: "WOMAN" },
      { id: "ID_TOPS", labels: { fr: "Tops", en: "Tops" }, gender: "WOMAN" },
    ]);
    pfsListProductsSpy.mockResolvedValue({
      data: [
        mkProduct({ ref: "A1", categoryId: "ID_ROBES", categoryFr: "Robes" }),
        mkProduct({ ref: "A2", categoryId: "ID_TOPS", categoryFr: "Tops" }),
      ],
      meta: { last_page: 1 },
    });

    const result = await scanPfsAttributes();
    const categoryAttrs = result.attributes.filter((a) => a.type === "category");
    expect(categoryAttrs).toHaveLength(2);
    expect(categoryAttrs.map((a) => a.pfsRef).sort()).toEqual(["ID_ROBES", "ID_TOPS"]);
  });
});
