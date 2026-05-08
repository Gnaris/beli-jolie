import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * Auto-traduction sur l'import PFS :
 * createOrLinkMapping doit déclencher autoTranslate* uniquement à la création
 * d'une nouvelle entité, jamais quand on lie à une entité existante.
 */

const {
  mockCategoryUpdate,
  mockCategoryCreate,
  mockCategoryFindFirst,
  mockColorUpdate,
  mockColorCreate,
  mockSizeUpdate,
  mockSizeCreate,
  mockCompositionUpdate,
  mockCompositionCreate,
  mockCountryUpdate,
  mockCountryCreate,
  mockCountryFindUnique,
  mockSeasonUpdate,
  mockSeasonCreate,
  mockCategoryTranslationUpsert,
  mockColorTranslationUpsert,
  mockCompositionTranslationUpsert,
  mockCountryTranslationUpsert,
  mockSeasonTranslationUpsert,
  autoTranslateCategorySpy,
  autoTranslateColorSpy,
  autoTranslateCompositionSpy,
  autoTranslateManufacturingCountrySpy,
  autoTranslateSeasonSpy,
  autoTranslateProductSpy,
} = vi.hoisted(() => ({
  mockCategoryUpdate: vi.fn(),
  mockCategoryCreate: vi.fn(),
  mockCategoryFindFirst: vi.fn().mockResolvedValue(null),
  mockColorUpdate: vi.fn(),
  mockColorCreate: vi.fn(),
  mockSizeUpdate: vi.fn(),
  mockSizeCreate: vi.fn(),
  mockCompositionUpdate: vi.fn(),
  mockCompositionCreate: vi.fn(),
  mockCountryUpdate: vi.fn(),
  mockCountryCreate: vi.fn(),
  mockCountryFindUnique: vi.fn().mockResolvedValue({ isoCode: null }),
  mockSeasonUpdate: vi.fn(),
  mockSeasonCreate: vi.fn(),
  mockCategoryTranslationUpsert: vi.fn(),
  mockColorTranslationUpsert: vi.fn(),
  mockCompositionTranslationUpsert: vi.fn(),
  mockCountryTranslationUpsert: vi.fn(),
  mockSeasonTranslationUpsert: vi.fn(),
  autoTranslateCategorySpy: vi.fn(),
  autoTranslateColorSpy: vi.fn(),
  autoTranslateCompositionSpy: vi.fn(),
  autoTranslateManufacturingCountrySpy: vi.fn(),
  autoTranslateSeasonSpy: vi.fn(),
  autoTranslateProductSpy: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    category: { update: mockCategoryUpdate, create: mockCategoryCreate, findFirst: mockCategoryFindFirst },
    color: { update: mockColorUpdate, create: mockColorCreate, findUnique: vi.fn().mockResolvedValue({ hex: null }) },
    size: { update: mockSizeUpdate, create: mockSizeCreate },
    composition: { update: mockCompositionUpdate, create: mockCompositionCreate },
    manufacturingCountry: { update: mockCountryUpdate, create: mockCountryCreate, findUnique: mockCountryFindUnique },
    season: { update: mockSeasonUpdate, create: mockSeasonCreate },
    categoryTranslation: { upsert: mockCategoryTranslationUpsert },
    colorTranslation: { upsert: mockColorTranslationUpsert },
    compositionTranslation: { upsert: mockCompositionTranslationUpsert },
    manufacturingCountryTranslation: { upsert: mockCountryTranslationUpsert },
    seasonTranslation: { upsert: mockSeasonTranslationUpsert },
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
vi.mock("@/lib/storage", () => ({
  keyFromDbPath: vi.fn(),
  deleteFiles: vi.fn(),
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

  it("taille TU : rattache à la « Taille unique » existante au lieu de créer un doublon", async () => {
    const mockSizeFindFirst = vi.fn().mockResolvedValue({
      id: "sz-protected",
      name: "Taille unique",
      pfsSizeRef: null,
    });
    const mockSizeUpdateRef = vi.fn().mockResolvedValue({});
    const prismaModule = await import("@/lib/prisma");
    (prismaModule.prisma as unknown as { size: Record<string, unknown> }).size = {
      create: mockSizeCreate,
      update: mockSizeUpdateRef,
      findFirst: mockSizeFindFirst,
    };
    const result = await createOrLinkMapping({ type: "size", pfsRef: "TU", label: "TU" });
    expect(result).toEqual({ id: "sz-protected", name: "Taille unique", created: false });
    expect(mockSizeCreate).not.toHaveBeenCalled();
    // pfsSizeRef manquant → mis à jour automatiquement
    expect(mockSizeUpdateRef).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: "sz-protected" },
      data: { pfsSizeRef: "TU" },
    }));
  });

  // ─── Avec libellé EN PFS : skip DeepL et upsert direct ─────────────────────

  it("catégorie : enLabel PFS → upsert traduction EN + pas d'appel DeepL", async () => {
    mockCategoryCreate.mockResolvedValue({ id: "cat-2", name: "Bagues" });
    await createOrLinkMapping({ type: "category", pfsRef: "BAGUES", label: "Bagues", enLabel: "Rings" });
    expect(mockCategoryTranslationUpsert).toHaveBeenCalledWith(expect.objectContaining({
      where: { categoryId_locale: { categoryId: "cat-2", locale: "en" } },
      create: { categoryId: "cat-2", locale: "en", name: "Rings" },
    }));
    expect(autoTranslateCategorySpy).not.toHaveBeenCalled();
  });

  it("couleur : enLabel PFS → upsert traduction EN + pas d'appel DeepL", async () => {
    mockColorCreate.mockResolvedValue({ id: "col-2", name: "Doré" });
    await createOrLinkMapping({ type: "color", pfsRef: "GOLDEN", label: "Doré", enLabel: "Gold" });
    expect(mockColorTranslationUpsert).toHaveBeenCalledWith(expect.objectContaining({
      create: { colorId: "col-2", locale: "en", name: "Gold" },
    }));
    expect(autoTranslateColorSpy).not.toHaveBeenCalled();
  });

  it("composition : enLabel PFS → upsert traduction EN + pas d'appel DeepL", async () => {
    mockCompositionCreate.mockResolvedValue({ id: "comp-2", name: "Coton" });
    await createOrLinkMapping({ type: "composition", pfsRef: "COTTON", label: "Coton", enLabel: "Cotton" });
    expect(mockCompositionTranslationUpsert).toHaveBeenCalledWith(expect.objectContaining({
      create: { compositionId: "comp-2", locale: "en", name: "Cotton" },
    }));
    expect(autoTranslateCompositionSpy).not.toHaveBeenCalled();
  });

  it("pays : enLabel PFS → upsert traduction EN + pas d'appel DeepL", async () => {
    mockCountryCreate.mockResolvedValue({ id: "ctry-2", name: "Chine" });
    await createOrLinkMapping({ type: "country", pfsRef: "Chine", label: "Chine", enLabel: "China" });
    expect(mockCountryTranslationUpsert).toHaveBeenCalledWith(expect.objectContaining({
      create: { manufacturingCountryId: "ctry-2", locale: "en", name: "China" },
    }));
    expect(autoTranslateManufacturingCountrySpy).not.toHaveBeenCalled();
  });

  it("saison : enLabel PFS → upsert traduction EN + pas d'appel DeepL", async () => {
    mockSeasonCreate.mockResolvedValue({ id: "sea-2", name: "Printemps 2026" });
    await createOrLinkMapping({ type: "season", pfsRef: "SS26", label: "Printemps 2026", enLabel: "Spring 2026" });
    expect(mockSeasonTranslationUpsert).toHaveBeenCalledWith(expect.objectContaining({
      create: { seasonId: "sea-2", locale: "en", name: "Spring 2026" },
    }));
    expect(autoTranslateSeasonSpy).not.toHaveBeenCalled();
  });

  it("enLabel identique au libellé FR → on enregistre quand même (PFS confirme la version EN) et on skippe DeepL", async () => {
    // Cas typique : « Bracelets » s'écrit pareil en FR et en EN. PFS le
    // confirme, donc on stocke la traduction et on n'a pas besoin de DeepL.
    mockCategoryCreate.mockResolvedValue({ id: "cat-3", name: "Bracelets" });
    await createOrLinkMapping({ type: "category", pfsRef: "BRACELETS", label: "Bracelets", enLabel: "Bracelets" });
    expect(mockCategoryTranslationUpsert).toHaveBeenCalledWith(expect.objectContaining({
      create: { categoryId: "cat-3", locale: "en", name: "Bracelets" },
    }));
    expect(autoTranslateCategorySpy).not.toHaveBeenCalled();
  });

  it("enLabel vide → on retombe sur DeepL", async () => {
    mockColorCreate.mockResolvedValue({ id: "col-4", name: "Bleu" });
    await createOrLinkMapping({ type: "color", pfsRef: "BLUE", label: "Bleu", enLabel: "" });
    expect(mockColorTranslationUpsert).not.toHaveBeenCalled();
    expect(autoTranslateColorSpy).toHaveBeenCalledWith("col-4", "Bleu");
  });

  // ─── Code ISO pays ─────────────────────────────────────────────────────────

  it("pays : enregistre isoCode à la création", async () => {
    mockCountryCreate.mockResolvedValue({ id: "ctry-3", name: "Chine" });
    await createOrLinkMapping({ type: "country", pfsRef: "Chine", label: "Chine", isoCode: "CN" });
    expect(mockCountryCreate).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ isoCode: "CN" }),
    }));
  });

  it("pays : isoCode invalide (longueur ≠ 2 ou caractères non-alpha) → null", async () => {
    mockCountryCreate.mockResolvedValue({ id: "ctry-4", name: "Inconnu" });
    await createOrLinkMapping({ type: "country", pfsRef: "Inconnu", label: "Inconnu", isoCode: "XYZ123" });
    expect(mockCountryCreate).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ isoCode: null }),
    }));
  });

  it("pays existant sans isoCode : on complète au lien", async () => {
    mockCountryFindUnique.mockResolvedValueOnce({ isoCode: null });
    mockCountryUpdate.mockResolvedValue({ id: "ctry-5", name: "France" });
    await createOrLinkMapping({
      type: "country",
      pfsRef: "France",
      label: "France",
      linkToExistingId: "ctry-5",
      isoCode: "FR",
    });
    expect(mockCountryUpdate).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ isoCode: "FR", pfsCountryRef: "France" }),
    }));
  });

  it("pays existant AVEC isoCode : on ne l'écrase pas", async () => {
    mockCountryFindUnique.mockResolvedValueOnce({ isoCode: "CN" });
    mockCountryUpdate.mockResolvedValue({ id: "ctry-6", name: "Chine" });
    await createOrLinkMapping({
      type: "country",
      pfsRef: "Chine",
      label: "Chine",
      linkToExistingId: "ctry-6",
      isoCode: "CN",
    });
    const call = mockCountryUpdate.mock.calls[0]?.[0];
    expect(call.data).not.toHaveProperty("isoCode");
    expect(call.data.pfsCountryRef).toBe("Chine");
  });
});
