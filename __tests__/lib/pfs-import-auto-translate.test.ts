import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * Auto-traduction sur l'import PFS :
 * createOrLinkMapping doit déclencher autoTranslate* uniquement à la création
 * d'une nouvelle entité, jamais quand on lie à une entité existante.
 */

const {
  mockCategoryUpdate,
  mockCategoryCreate,
  mockColorUpdate,
  mockColorCreate,
  mockSizeUpdate,
  mockSizeCreate,
  mockCompositionUpdate,
  mockCompositionCreate,
  mockCountryUpdate,
  mockCountryCreate,
  mockSeasonUpdate,
  mockSeasonCreate,
  autoTranslateCategorySpy,
  autoTranslateColorSpy,
  autoTranslateCompositionSpy,
  autoTranslateManufacturingCountrySpy,
  autoTranslateSeasonSpy,
  autoTranslateProductSpy,
} = vi.hoisted(() => ({
  mockCategoryUpdate: vi.fn(),
  mockCategoryCreate: vi.fn(),
  mockColorUpdate: vi.fn(),
  mockColorCreate: vi.fn(),
  mockSizeUpdate: vi.fn(),
  mockSizeCreate: vi.fn(),
  mockCompositionUpdate: vi.fn(),
  mockCompositionCreate: vi.fn(),
  mockCountryUpdate: vi.fn(),
  mockCountryCreate: vi.fn(),
  mockSeasonUpdate: vi.fn(),
  mockSeasonCreate: vi.fn(),
  autoTranslateCategorySpy: vi.fn(),
  autoTranslateColorSpy: vi.fn(),
  autoTranslateCompositionSpy: vi.fn(),
  autoTranslateManufacturingCountrySpy: vi.fn(),
  autoTranslateSeasonSpy: vi.fn(),
  autoTranslateProductSpy: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    category: { update: mockCategoryUpdate, create: mockCategoryCreate },
    color: { update: mockColorUpdate, create: mockColorCreate },
    size: { update: mockSizeUpdate, create: mockSizeCreate },
    composition: { update: mockCompositionUpdate, create: mockCompositionCreate },
    manufacturingCountry: { update: mockCountryUpdate, create: mockCountryCreate },
    season: { update: mockSeasonUpdate, create: mockSeasonCreate },
  },
}));

vi.mock("@/lib/auto-translate", () => ({
  autoTranslateCategory: autoTranslateCategorySpy,
  autoTranslateColor: autoTranslateColorSpy,
  autoTranslateComposition: autoTranslateCompositionSpy,
  autoTranslateManufacturingCountry: autoTranslateManufacturingCountrySpy,
  autoTranslateSeason: autoTranslateSeasonSpy,
  autoTranslateProduct: autoTranslateProductSpy,
}));

vi.mock("@/lib/pfs-api", () => ({
  pfsListProducts: vi.fn(),
  pfsCheckReference: vi.fn(),
  pfsGetVariants: vi.fn(),
}));

vi.mock("@/lib/image-processor", () => ({ processProductImage: vi.fn() }));
vi.mock("@/lib/image-utils", () => ({ getImagePaths: vi.fn() }));
vi.mock("@/lib/r2", () => ({
  r2KeyFromDbPath: vi.fn(),
  deleteMultipleFromR2: vi.fn(),
}));
vi.mock("@/lib/product-events", () => ({ emitProductEvent: vi.fn() }));
vi.mock("@/lib/sku", () => ({ generateSku: vi.fn(() => "SKU") }));
vi.mock("@/lib/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

import { createOrLinkMapping } from "@/lib/pfs-import";

describe("createOrLinkMapping — auto-traduction", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("déclenche autoTranslateCategory à la création d'une catégorie", async () => {
    mockCategoryCreate.mockResolvedValue({ id: "cat-1", name: "Bagues" });
    await createOrLinkMapping({ type: "category", pfsRef: "BAGUES", label: "Bagues" });
    expect(autoTranslateCategorySpy).toHaveBeenCalledWith("cat-1", "Bagues");
  });

  it("ne traduit PAS si on lie à une catégorie existante", async () => {
    mockCategoryUpdate.mockResolvedValue({ id: "cat-1", name: "Bagues" });
    await createOrLinkMapping({
      type: "category",
      pfsRef: "BAGUES",
      label: "Bagues",
      linkToExistingId: "cat-1",
    });
    expect(autoTranslateCategorySpy).not.toHaveBeenCalled();
  });

  it("déclenche autoTranslateColor à la création d'une couleur", async () => {
    mockColorCreate.mockResolvedValue({ id: "col-1", name: "Doré" });
    await createOrLinkMapping({ type: "color", pfsRef: "GOLDEN", label: "Doré" });
    expect(autoTranslateColorSpy).toHaveBeenCalledWith("col-1", "Doré");
  });

  it("ne traduit PAS si on lie à une couleur existante", async () => {
    mockColorUpdate.mockResolvedValue({ id: "col-1", name: "Doré" });
    await createOrLinkMapping({
      type: "color",
      pfsRef: "GOLDEN",
      label: "Doré",
      linkToExistingId: "col-1",
    });
    expect(autoTranslateColorSpy).not.toHaveBeenCalled();
  });

  it("déclenche autoTranslateComposition à la création", async () => {
    mockCompositionCreate.mockResolvedValue({ id: "comp-1", name: "Coton" });
    await createOrLinkMapping({ type: "composition", pfsRef: "COTTON", label: "Coton" });
    expect(autoTranslateCompositionSpy).toHaveBeenCalledWith("comp-1", "Coton");
  });

  it("déclenche autoTranslateManufacturingCountry à la création", async () => {
    mockCountryCreate.mockResolvedValue({ id: "ctry-1", name: "Chine" });
    await createOrLinkMapping({ type: "country", pfsRef: "CN", label: "Chine" });
    expect(autoTranslateManufacturingCountrySpy).toHaveBeenCalledWith("ctry-1", "Chine");
  });

  it("déclenche autoTranslateSeason à la création", async () => {
    mockSeasonCreate.mockResolvedValue({ id: "sea-1", name: "Printemps 2026" });
    await createOrLinkMapping({ type: "season", pfsRef: "SS26", label: "Printemps 2026" });
    expect(autoTranslateSeasonSpy).toHaveBeenCalledWith("sea-1", "Printemps 2026");
  });

  it("ne déclenche aucune traduction pour une taille (pas de table de traduction)", async () => {
    mockSizeCreate.mockResolvedValue({ id: "sz-1", name: "M" });
    await createOrLinkMapping({ type: "size", pfsRef: "M", label: "M" });
    expect(autoTranslateCategorySpy).not.toHaveBeenCalled();
    expect(autoTranslateColorSpy).not.toHaveBeenCalled();
    expect(autoTranslateCompositionSpy).not.toHaveBeenCalled();
    expect(autoTranslateManufacturingCountrySpy).not.toHaveBeenCalled();
    expect(autoTranslateSeasonSpy).not.toHaveBeenCalled();
  });
});
