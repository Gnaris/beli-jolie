import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * Couvre les 3 régressions observées sur l'import de FZEAFSDF :
 *  1) Le détail de la taille unique (`size_details_tu` PFS) n'était pas
 *     propagé sur `Product.sizeDetailsTu` côté boutique.
 *  2) Le code couleur PFS d'une couleur déjà présente en bibliothèque locale
 *     n'était jamais appliqué — l'aperçu du modal d'images restait gris.
 *  3) Côté plan d'images : la création passe bien par les helpers exportés
 *     (déjà couverts dans pfs-import-pack-images.test.ts).
 *
 * Stratégie : on mocke l'API PFS pour renvoyer un produit en taille unique
 * sans aucune image (pour court-circuiter le téléchargement Playwright), puis
 * on inspecte les appels Prisma.
 */

const {
  mockProductFindUnique,
  mockProductCreate,
  mockProductUpdate,
  mockProductColorCreate,
  mockCategoryFindFirst,
  mockColorFindFirst,
  mockColorUpdate,
  mockColorFindMany,
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
  mockProductFindUnique: vi.fn(),
  mockProductCreate: vi.fn(),
  mockProductUpdate: vi.fn(),
  mockProductColorCreate: vi.fn(),
  mockCategoryFindFirst: vi.fn(),
  mockColorFindFirst: vi.fn(),
  mockColorUpdate: vi.fn(),
  mockColorFindMany: vi.fn(),
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
    product: {
      findUnique: mockProductFindUnique,
      create: mockProductCreate,
      update: mockProductUpdate,
    },
    productColor: { create: mockProductColorCreate },
    category: { findFirst: mockCategoryFindFirst, findMany: vi.fn() },
    color: {
      findFirst: mockColorFindFirst,
      update: mockColorUpdate,
      findMany: mockColorFindMany,
    },
    size: { findFirst: mockSizeFindFirst, findMany: vi.fn() },
    season: { findFirst: mockSeasonFindFirst },
    manufacturingCountry: { findFirst: mockCountryFindFirst },
    composition: { findFirst: mockCompositionFindFirst },
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

import { approveAndImportPfsProduct } from "@/lib/pfs-import";
import { __resetPfsListCacheForTests } from "@/lib/pfs-list-cache";

function mkPfsProduct() {
  // Produit en taille unique avec un détail (52-56) — comme FZEAFSDF côté PFS.
  // Aucune image (pour court-circuiter Playwright dans le test).
  return {
    id: "pfs-fzeafsdf",
    reference: "FZEAFSDF",
    brand: { id: "b", name: "Beli Jolie" },
    gender: "WOMAN",
    family: "Bijoux_Fantaisie",
    category: { id: "cat-pfs-1", labels: { fr: "Bagues" } },
    labels: { fr: "Bague kaki" },
    colors: "KAKI",
    sizes: "TU",
    size_details_tu: "52-56",
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
            id: 41,
            reference: "KAKI",
            value: "#595F34",
            image: null,
            labels: { fr: "Kaki", en: "Kaki" },
          },
          size: "TU",
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

describe("approveAndImportPfsProduct — corrections FZEAFSDF", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    __resetPfsListCacheForTests();

    pfsListProductsSpy.mockResolvedValue({
      data: [mkPfsProduct()],
      meta: { current_page: 1, last_page: 1, from: 1, per_page: 100, total: 1 },
    });
    pfsCheckReferenceSpy.mockResolvedValue({
      exists: true,
      product: {
        id: "pfs-fzeafsdf",
        brand: { id: "b", name: "Beli Jolie" },
        gender: { reference: "WOMAN" },
        family: { id: "Bijoux_Fantaisie", reference: "Bijoux_Fantaisie" },
        category: { id: "cat-pfs-1", reference: "Bagues" },
        reference: "FZEAFSDF",
        label: { fr: "Bague kaki" },
        material_composition: [],
        lining_composition: [],
        country_of_manufacture: "",
        description: { fr: "Description" },
        status: "READY_FOR_SALE",
        default_color: "KAKI",
        images: {},
        flash_sales_discount: null,
      },
    });
    pfsGetVariantsSpy.mockResolvedValue({ data: [] }); // fallback sur product.variants inline
    pfsGetCategoriesSpy.mockResolvedValue([]);
    pfsGetFamiliesSpy.mockResolvedValue([]);

    mockProductFindUnique.mockResolvedValue(null);
    mockCategoryFindFirst.mockResolvedValue({ id: "cat-local-1", name: "Bagues" });
    mockSizeFindFirst.mockResolvedValue({ id: "size-tu" });
    mockSeasonFindFirst.mockResolvedValue(null);
    mockCountryFindFirst.mockResolvedValue(null);
    mockCompositionFindFirst.mockResolvedValue(null);
    mockColorFindMany.mockResolvedValue([{ id: "col-kaki-local", name: "Kaki" }]);
    mockProductCreate.mockResolvedValue({ id: "prod-local-1", reference: "FZEAFSDF", name: "Bague kaki" });
    mockProductColorCreate.mockResolvedValue({ id: "pc-1", colorId: "col-kaki-local" });
    mockVariantSizeCreateMany.mockResolvedValue({ count: 1 });
  });

  it("propage size_details_tu PFS dans Product.sizeDetailsTu", async () => {
    mockColorFindFirst.mockResolvedValue({ id: "col-kaki-local", hex: "#595F34" });

    await approveAndImportPfsProduct("pfs-fzeafsdf");

    expect(mockProductCreate).toHaveBeenCalledTimes(1);
    const createArgs = mockProductCreate.mock.calls[0][0];
    expect(createArgs.data.sizeDetailsTu).toBe("52-56");
    expect(createArgs.data.reference).toBe("FZEAFSDF");
  });

  it("pose Product.primaryColorId sur la couleur déduite du default_color PFS", async () => {
    mockColorFindFirst.mockResolvedValue({ id: "col-kaki-local", hex: "#595F34" });

    await approveAndImportPfsProduct("pfs-fzeafsdf");

    const createArgs = mockProductCreate.mock.calls[0][0];
    // PFS renvoie default_color="KAKI" → Product.primaryColorId = colorId local de Kaki
    expect(createArgs.data.primaryColorId).toBe("col-kaki-local");
  });

  it("met à jour le hex d'une couleur locale qui n'en avait pas avec celui fourni par PFS", async () => {
    // La couleur "Kaki" existe en BDD mais sans hex → PFS fournit #595F34.
    mockColorFindFirst.mockResolvedValue({ id: "col-kaki-local", hex: null });

    await approveAndImportPfsProduct("pfs-fzeafsdf");

    expect(mockColorUpdate).toHaveBeenCalledWith({
      where: { id: "col-kaki-local" },
      data: { hex: "#595f34" },
    });
  });

  it("ne touche pas au hex d'une couleur locale qui en a déjà un (admin l'a saisi)", async () => {
    mockColorFindFirst.mockResolvedValue({ id: "col-kaki-local", hex: "#aabbcc" });

    await approveAndImportPfsProduct("pfs-fzeafsdf");

    expect(mockColorUpdate).not.toHaveBeenCalled();
  });

  it("défaut sizeDetailsTu=\"0\" quand la variante utilise TU mais que PFS renvoie vide", async () => {
    // Le produit a sizes:"TU" et la variante porte size:"TU" → on doit
    // remplacer la chaîne vide par "0" pour satisfaire la validation
    // « Détail taille unique obligatoire ». L'admin pourra ajuster ensuite.
    mockColorFindFirst.mockResolvedValue({ id: "col-kaki-local", hex: "#595F34" });
    pfsListProductsSpy.mockResolvedValueOnce({
      data: [{ ...mkPfsProduct(), size_details_tu: "  " }],
      meta: { current_page: 1, last_page: 1, from: 1, per_page: 100, total: 1 },
    });

    await approveAndImportPfsProduct("pfs-fzeafsdf");

    const createArgs = mockProductCreate.mock.calls[0][0];
    expect(createArgs.data.sizeDetailsTu).toBe("0");
  });

  it("stocke null pour sizeDetailsTu si la variante n'utilise pas TU", async () => {
    // Variante en taille classique (M) → pas de défaut "0", on garde null
    // quand size_details_tu est vide.
    mockColorFindFirst.mockResolvedValue({ id: "col-kaki-local", hex: "#595F34" });
    const base = mkPfsProduct();
    pfsListProductsSpy.mockResolvedValueOnce({
      data: [
        {
          ...base,
          sizes: "M",
          size_details_tu: "",
          variants: [
            {
              ...base.variants[0],
              item: { ...base.variants[0].item, size: "M" },
            },
          ],
        },
      ],
      meta: { current_page: 1, last_page: 1, from: 1, per_page: 100, total: 1 },
    });

    await approveAndImportPfsProduct("pfs-fzeafsdf");

    const createArgs = mockProductCreate.mock.calls[0][0];
    expect(createArgs.data.sizeDetailsTu).toBeNull();
  });
});
