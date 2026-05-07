import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * Compositions et pays : on stocke le **libellé FR** (et plus la référence
 * brute renvoyée par PFS) dans le champ `pfsRef` du scan ET dans le matching
 * produit→pays/composition. Sans ça, le CustomSelect du mapping affichait
 * une valeur (label FR) qui ne correspondait pas à la valeur stockée
 * (référence brute) — résultat : menu déroulant vide à la ré-ouverture, et
 * matching qui échouait à l'import.
 *
 * Les saisons fonctionnaient déjà parce que le code utilise `c.reference`
 * partout (ex: "PE2026"). On ne touche donc pas à leur logique.
 */

const {
  mockCategoryFindMany,
  mockColorFindMany,
  mockSizeFindMany,
  mockCompositionFindMany,
  mockCountryFindMany,
  mockSeasonFindMany,
  mockProductFindMany,
  mockProductFindUnique,
  mockProductCreate,
  mockProductUpdate,
  mockProductColorCreate,
  mockCategoryFindFirst,
  mockColorFindFirst,
  mockColorUpdate,
  mockSizeFindFirst,
  mockSeasonFindFirst,
  mockCountryFindFirst,
  mockCompositionFindFirst,
  mockVariantSizeCreateMany,
  pfsListProductsSpy,
  pfsCheckReferenceSpy,
  pfsGetVariantsSpy,
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
  mockProductFindUnique: vi.fn(),
  mockProductCreate: vi.fn(),
  mockProductUpdate: vi.fn(),
  mockProductColorCreate: vi.fn(),
  mockCategoryFindFirst: vi.fn(),
  mockColorFindFirst: vi.fn(),
  mockColorUpdate: vi.fn(),
  mockSizeFindFirst: vi.fn(),
  mockSeasonFindFirst: vi.fn(),
  mockCountryFindFirst: vi.fn(),
  mockCompositionFindFirst: vi.fn(),
  mockVariantSizeCreateMany: vi.fn(),
  pfsListProductsSpy: vi.fn(),
  pfsCheckReferenceSpy: vi.fn(),
  pfsGetVariantsSpy: vi.fn(),
  pfsGetCategoriesSpy: vi.fn(),
  pfsGetFamiliesSpy: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    category: { findMany: mockCategoryFindMany, findFirst: mockCategoryFindFirst },
    color: {
      findMany: mockColorFindMany,
      findFirst: mockColorFindFirst,
      update: mockColorUpdate,
    },
    size: { findMany: mockSizeFindMany, findFirst: mockSizeFindFirst },
    composition: {
      findMany: mockCompositionFindMany,
      findFirst: mockCompositionFindFirst,
    },
    manufacturingCountry: {
      findMany: mockCountryFindMany,
      findFirst: mockCountryFindFirst,
    },
    season: { findMany: mockSeasonFindMany, findFirst: mockSeasonFindFirst },
    product: {
      findMany: mockProductFindMany,
      findUnique: mockProductFindUnique,
      create: mockProductCreate,
      update: mockProductUpdate,
    },
    productColor: { create: mockProductColorCreate },
    variantSize: { createMany: mockVariantSizeCreateMany },
    packColorLine: { create: vi.fn() },
  },
}));

vi.mock("@/lib/pfs-api", async () => {
  const actual = await vi.importActual<typeof import("@/lib/pfs-api")>("@/lib/pfs-api");
  return {
    ...actual,
    pfsListProducts: pfsListProductsSpy,
    pfsCheckReference: pfsCheckReferenceSpy,
    pfsGetVariants: pfsGetVariantsSpy,
  };
});

vi.mock("@/lib/pfs-api-write", () => ({
  pfsGetCategories: pfsGetCategoriesSpy,
  pfsGetFamilies: pfsGetFamiliesSpy,
}));

vi.mock("@/lib/auto-translate", () => ({
  autoTranslateCategory: vi.fn(),
  autoTranslateColor: vi.fn(),
  autoTranslateComposition: vi.fn(),
  autoTranslateManufacturingCountry: vi.fn(),
  autoTranslateProduct: vi.fn(),
  autoTranslateSeason: vi.fn(),
}));

vi.mock("@/lib/image-processor", () => ({ processProductImage: vi.fn() }));
vi.mock("@/lib/image-utils", () => ({ getImagePaths: vi.fn() }));
vi.mock("@/lib/storage", () => ({ keyFromDbPath: vi.fn(), deleteFiles: vi.fn() }));
vi.mock("@/lib/product-events", () => ({ emitProductEvent: vi.fn() }));
vi.mock("@/lib/sku", () => ({ generateSku: vi.fn(() => "SKU-TEST") }));
vi.mock("@/lib/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

import { scanPfsAttributes, approveAndImportPfsProduct } from "@/lib/pfs-import";
import { __resetPfsListCacheForTests } from "@/lib/pfs-list-cache";

function mkPfsListProduct() {
  return {
    id: "pfs-1",
    reference: "REF-1",
    family: "Bijoux_Fantaisie",
    category: { id: "cat-pfs-1", labels: { fr: "Bagues", en: "Rings" } },
    labels: { fr: "Bague test" },
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
  };
}

describe("scanPfsAttributes — pfsRef = libellé FR pour compositions et pays", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    __resetPfsListCacheForTests();
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
          { reference: "polyester", labels: { fr: "Polyester", en: "Polyester" } },
        ],
        country_of_manufacture: "CN",
        collection: { reference: "PE2026", labels: { fr: "Printemps/Été 2026" } },
      },
    });
    pfsGetCategoriesSpy.mockResolvedValue([]);
    pfsListProductsSpy.mockResolvedValue({
      data: [mkPfsListProduct()],
      meta: { last_page: 1 },
    });
  });

  it("retourne la composition avec pfsRef = label FR (et non la référence brute PFS)", async () => {
    const result = await scanPfsAttributes();
    const comp = result.attributes.find((a) => a.type === "composition");
    expect(comp).toBeDefined();
    expect(comp?.pfsRef).toBe("Polyester");
    expect(comp?.label).toBe("Polyester");
  });

  it("retourne le pays avec pfsRef = label FR (et non le code ISO PFS)", async () => {
    const result = await scanPfsAttributes();
    const country = result.attributes.find((a) => a.type === "country");
    expect(country).toBeDefined();
    expect(country?.pfsRef).toBe("Chine");
    expect(country?.label).toBe("Chine");
  });

  it("retourne la saison avec pfsRef = référence PFS (comportement inchangé)", async () => {
    const result = await scanPfsAttributes();
    const season = result.attributes.find((a) => a.type === "season");
    expect(season).toBeDefined();
    expect(season?.pfsRef).toBe("PE2026");
    expect(season?.label).toBe("Printemps/Été 2026");
  });

  it("retombe sur le label EN si le label FR est absent (composition)", async () => {
    pfsCheckReferenceSpy.mockResolvedValueOnce({
      product: {
        material_composition: [
          { reference: "wool", labels: { en: "Wool" } },
        ],
        country_of_manufacture: "CN",
        collection: { reference: "PE2026", labels: { fr: "Printemps/Été 2026" } },
      },
    });

    const result = await scanPfsAttributes();
    const comp = result.attributes.find((a) => a.type === "composition");
    expect(comp?.pfsRef).toBe("Wool");
  });

  it("retombe sur le code brut si countryLabel ne connaît pas le code ISO", async () => {
    pfsCheckReferenceSpy.mockResolvedValueOnce({
      product: {
        material_composition: [],
        country_of_manufacture: "ZZ", // code inconnu
        collection: { reference: "PE2026", labels: { fr: "Printemps/Été 2026" } },
      },
    });

    const result = await scanPfsAttributes();
    const country = result.attributes.find((a) => a.type === "country");
    // Quand countryLabel ne connaît pas le code, il retourne le code brut.
    expect(country?.pfsRef).toBe("ZZ");
    expect(country?.label).toBe("ZZ");
  });
});

// ─────────────────────────────────────────────
// Helpers communs au flow d'import
// ─────────────────────────────────────────────

function mkApprovePfsProduct() {
  return {
    id: "pfs-approve-1",
    reference: "APPROVE-1",
    brand: { id: "b", name: "Beli Jolie" },
    gender: "WOMAN",
    family: "Bijoux_Fantaisie",
    category: { id: "cat-pfs-1", labels: { fr: "Bagues" } },
    labels: { fr: "Bague test" },
    colors: "Doré",
    sizes: "M",
    size_details_tu: null,
    unit_price: 10,
    creation_date: "2026-01-01",
    status: "READY_FOR_SALE",
    is_star: 0,
    count_variants: 1,
    images: {},
    flash_sales_discount: null,
    variants: [
      {
        id: "v-1",
        sku_suffix: null,
        type: "ITEM",
        custom_suffix: "",
        pieces: 1,
        price_sale: { unit: { value: 10, currency: "EUR" }, total: { value: 10, currency: "EUR" } },
        price_before_discount: { unit: { value: 10, currency: "EUR" }, total: { value: 10, currency: "EUR" } },
        discount: null,
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
        is_active: true,
        is_star: false,
        in_stock: true,
        stock_qty: 5,
        weight: 1,
        creation_date: null,
        images: {},
      },
    ],
  };
}

describe("approveAndImportPfsProduct — matching pays/composition par libellé FR", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    __resetPfsListCacheForTests();

    pfsListProductsSpy.mockResolvedValue({
      data: [mkApprovePfsProduct()],
      meta: { current_page: 1, last_page: 1, from: 1, per_page: 100, total: 1 },
    });
    pfsCheckReferenceSpy.mockResolvedValue({
      exists: true,
      product: {
        id: "pfs-approve-1",
        brand: { id: "b", name: "Beli Jolie" },
        gender: { reference: "WOMAN" },
        family: { id: "Bijoux_Fantaisie", reference: "Bijoux_Fantaisie" },
        category: { id: "cat-pfs-1", reference: "Bagues" },
        reference: "APPROVE-1",
        label: { fr: "Bague test" },
        material_composition: [
          { reference: "polyester", percentage: 100, labels: { fr: "Polyester", en: "Polyester" } },
        ],
        lining_composition: [],
        country_of_manufacture: "CN",
        description: { fr: "Description" },
        status: "READY_FOR_SALE",
        default_color: "GOLDEN",
        images: {},
        flash_sales_discount: null,
      },
    });
    pfsGetVariantsSpy.mockResolvedValue({ data: [] });
    pfsGetCategoriesSpy.mockResolvedValue([]);
    pfsGetFamiliesSpy.mockResolvedValue([]);

    mockProductFindUnique.mockResolvedValue(null);
    mockCategoryFindFirst.mockResolvedValue({ id: "cat-local-1", name: "Bagues" });
    mockColorFindFirst.mockResolvedValue({ id: "col-gold-local", hex: "#D4AF37" });
    mockSizeFindFirst.mockResolvedValue({ id: "size-m" });
    mockSeasonFindFirst.mockResolvedValue(null);
    mockProductCreate.mockResolvedValue({ id: "prod-local-1", reference: "APPROVE-1", name: "Bague test" });
    mockProductColorCreate.mockResolvedValue({ id: "pc-1", colorId: "col-gold-local" });
    mockVariantSizeCreateMany.mockResolvedValue({ count: 1 });
  });

  it("raccroche le produit au pays existant dont pfsCountryRef vaut le libellé FR (Chine)", async () => {
    mockCountryFindFirst.mockImplementation(async (args: { where: { pfsCountryRef: string } }) => {
      if (args.where.pfsCountryRef === "Chine") {
        return { id: "ctry-chine-local" };
      }
      return null;
    });
    mockCompositionFindFirst.mockResolvedValue(null);

    await approveAndImportPfsProduct("pfs-approve-1");

    // La requête a bien été faite avec le libellé FR (et non "CN").
    expect(mockCountryFindFirst).toHaveBeenCalledWith({
      where: { pfsCountryRef: "Chine" },
      select: { id: true },
    });
    // Le produit a été créé avec le manufacturingCountryId résolu.
    const createArgs = mockProductCreate.mock.calls[0][0];
    expect(createArgs.data.manufacturingCountryId).toBe("ctry-chine-local");
  });

  it("raccroche le produit à la composition existante dont pfsCompositionRef vaut le libellé FR (Polyester)", async () => {
    mockCountryFindFirst.mockResolvedValue(null);
    mockCompositionFindFirst.mockImplementation(async (args: { where: { pfsCompositionRef: string } }) => {
      if (args.where.pfsCompositionRef === "Polyester") {
        return { id: "comp-poly-local" };
      }
      return null;
    });

    await approveAndImportPfsProduct("pfs-approve-1");

    expect(mockCompositionFindFirst).toHaveBeenCalledWith({
      where: { pfsCompositionRef: "Polyester" },
      select: { id: true },
    });
    // La composition a été ajoutée au produit créé via la relation imbriquée.
    const createArgs = mockProductCreate.mock.calls[0][0];
    expect(createArgs.data.compositions?.create).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ compositionId: "comp-poly-local", percentage: 100 }),
      ]),
    );
  });

  it("ajoute un avertissement avec le libellé FR quand le pays n'est pas mappé", async () => {
    mockCountryFindFirst.mockResolvedValue(null);
    mockCompositionFindFirst.mockResolvedValue(null);

    const result = await approveAndImportPfsProduct("pfs-approve-1");

    // L'avertissement contient bien "Chine" et pas "CN".
    expect(result.warnings).toEqual(
      expect.arrayContaining([expect.stringContaining("Chine")]),
    );
    expect(result.warnings.some((w) => w.includes("\"CN\""))).toBe(false);
  });

  it("ajoute un avertissement avec le libellé FR quand la composition n'est pas mappée", async () => {
    mockCountryFindFirst.mockResolvedValue(null);
    mockCompositionFindFirst.mockResolvedValue(null);

    const result = await approveAndImportPfsProduct("pfs-approve-1");

    expect(result.warnings).toEqual(
      expect.arrayContaining([expect.stringContaining("Polyester")]),
    );
  });
});
