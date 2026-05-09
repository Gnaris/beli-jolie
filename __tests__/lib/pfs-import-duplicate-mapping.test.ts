import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * Bug : PFS expose parfois deux entrées pour le même attribut (catégorie,
 * couleur, taille…) — même libellé mais deux IDs PFS distincts (ID ancien
 * obsolète + ID nouveau actif). Avant le fix, le 2ème createOrLinkMapping
 * tentait un `prisma.X.create({ name })` qui plantait sur la contrainte
 * unique `name @unique`. Le bulk-create en restait bloqué.
 *
 * Fix attendu : si une entité du même nom existe déjà localement avec une
 * référence PFS différente, on alias silencieusement (on garde le mapping
 * existant intact) et on renvoie OK pour ne pas bloquer le flux.
 */

const mocks = vi.hoisted(() => ({
  category: {
    update: vi.fn(),
    create: vi.fn(),
    findFirst: vi.fn(),
  },
  color: {
    update: vi.fn(),
    create: vi.fn(),
    findUnique: vi.fn(),
    findFirst: vi.fn(),
  },
  size: {
    update: vi.fn(),
    create: vi.fn(),
    findFirst: vi.fn(),
  },
  composition: {
    update: vi.fn(),
    create: vi.fn(),
    findFirst: vi.fn(),
  },
  manufacturingCountry: {
    update: vi.fn(),
    create: vi.fn(),
    findUnique: vi.fn(),
    findFirst: vi.fn(),
  },
  season: {
    update: vi.fn(),
    create: vi.fn(),
    findFirst: vi.fn(),
  },
  loggerWarn: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    category: mocks.category,
    color: mocks.color,
    size: mocks.size,
    composition: mocks.composition,
    manufacturingCountry: mocks.manufacturingCountry,
    season: mocks.season,
    categoryTranslation: { upsert: vi.fn() },
    colorTranslation: { upsert: vi.fn() },
    compositionTranslation: { upsert: vi.fn() },
    manufacturingCountryTranslation: { upsert: vi.fn() },
    seasonTranslation: { upsert: vi.fn() },
  },
}));

vi.mock("@/lib/auto-translate", () => ({
  autoTranslateCategory: vi.fn(),
  autoTranslateColor: vi.fn(),
  autoTranslateComposition: vi.fn(),
  autoTranslateManufacturingCountry: vi.fn(),
  autoTranslateSeason: vi.fn(),
  autoTranslateProduct: vi.fn(),
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
  logger: { info: vi.fn(), warn: mocks.loggerWarn, error: vi.fn() },
}));

import { createOrLinkMapping } from "@/lib/pfs-import";

beforeEach(() => {
  vi.clearAllMocks();
});

describe("createOrLinkMapping — doublons PFS (alias silencieux)", () => {
  it("catégorie : 2ème PFS ID avec même nom → alias, pas de create, pas d'erreur", async () => {
    // Local: cat "Robes" déjà mappée à PFS_OLD
    mocks.category.findFirst
      .mockResolvedValueOnce(null) // findFirst by pfsCategoryId = PFS_NEW
      .mockResolvedValueOnce({ id: "cat-1", name: "Robes", pfsCategoryId: "PFS_OLD" });

    const result = await createOrLinkMapping({
      type: "category",
      pfsRef: "PFS_NEW",
      label: "Robes",
      pfsFamilyName: "Robes",
    });

    expect(result).toEqual({ id: "cat-1", name: "Robes", created: false });
    expect(mocks.category.create).not.toHaveBeenCalled();
    expect(mocks.category.update).not.toHaveBeenCalled(); // alias = pas de mutation
    expect(mocks.loggerWarn).toHaveBeenCalledOnce();
    expect(mocks.loggerWarn.mock.calls[0][0]).toContain("Doublon PFS catégorie");
  });

  it("catégorie : même PFS ID → update normal des méta", async () => {
    mocks.category.findFirst
      .mockResolvedValueOnce(null) // by pfsCategoryId
      .mockResolvedValueOnce({ id: "cat-2", name: "Robes", pfsCategoryId: "PFS_SAME" });
    mocks.category.update.mockResolvedValue({ id: "cat-2", name: "Robes" });

    const result = await createOrLinkMapping({
      type: "category",
      pfsRef: "PFS_SAME",
      label: "Robes",
    });

    expect(result.id).toBe("cat-2");
    expect(mocks.category.update).toHaveBeenCalledOnce();
    expect(mocks.loggerWarn).not.toHaveBeenCalled();
  });

  it("catégorie : pas de pfsCategoryId existant → on remplit normalement", async () => {
    mocks.category.findFirst
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ id: "cat-3", name: "Robes", pfsCategoryId: null });
    mocks.category.update.mockResolvedValue({ id: "cat-3", name: "Robes" });

    await createOrLinkMapping({
      type: "category",
      pfsRef: "PFS_NEW",
      label: "Robes",
    });

    expect(mocks.category.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "cat-3" },
        data: expect.objectContaining({ pfsCategoryId: "PFS_NEW" }),
      }),
    );
    expect(mocks.loggerWarn).not.toHaveBeenCalled();
  });

  it("couleur : doublon PFS sur même nom → alias", async () => {
    mocks.color.findFirst.mockResolvedValue({
      id: "col-1",
      name: "Rouge",
      hex: "#ff0000",
      pfsColorRef: "RED_OLD",
    });

    const result = await createOrLinkMapping({
      type: "color",
      pfsRef: "RED_NEW",
      label: "Rouge",
    });

    expect(result).toEqual({ id: "col-1", name: "Rouge", created: false });
    expect(mocks.color.create).not.toHaveBeenCalled();
    expect(mocks.color.update).not.toHaveBeenCalled();
    expect(mocks.loggerWarn).toHaveBeenCalledOnce();
    expect(mocks.loggerWarn.mock.calls[0][0]).toContain("Doublon PFS couleur");
  });

  it("taille : doublon PFS sur même nom → alias", async () => {
    mocks.size.findFirst.mockResolvedValue({
      id: "sz-1",
      name: "M",
      pfsSizeRef: "SIZE_M_OLD",
    });

    const result = await createOrLinkMapping({
      type: "size",
      pfsRef: "SIZE_M_NEW",
      label: "M",
    });

    expect(result).toEqual({ id: "sz-1", name: "M", created: false });
    expect(mocks.size.create).not.toHaveBeenCalled();
    expect(mocks.size.update).not.toHaveBeenCalled();
    expect(mocks.loggerWarn.mock.calls[0][0]).toContain("Doublon PFS taille");
  });

  it("composition : doublon PFS sur même nom → alias", async () => {
    mocks.composition.findFirst.mockResolvedValue({
      id: "co-1",
      name: "Coton",
      pfsCompositionRef: "COTTON_OLD",
    });

    const result = await createOrLinkMapping({
      type: "composition",
      pfsRef: "COTTON_NEW",
      label: "Coton",
    });

    expect(result).toEqual({ id: "co-1", name: "Coton", created: false });
    expect(mocks.composition.create).not.toHaveBeenCalled();
    expect(mocks.loggerWarn.mock.calls[0][0]).toContain("Doublon PFS composition");
  });

  it("pays : doublon PFS sur même nom → alias", async () => {
    mocks.manufacturingCountry.findFirst.mockResolvedValue({
      id: "co-1",
      name: "Chine",
      pfsCountryRef: "Chine",
      isoCode: "CN",
    });

    const result = await createOrLinkMapping({
      type: "country",
      pfsRef: "ChineDoublon",
      label: "Chine",
      isoCode: "CN",
    });

    expect(result).toEqual({ id: "co-1", name: "Chine", created: false });
    expect(mocks.manufacturingCountry.create).not.toHaveBeenCalled();
    expect(mocks.loggerWarn.mock.calls[0][0]).toContain("Doublon PFS pays");
  });

  it("saison : doublon PFS sur même nom → alias", async () => {
    mocks.season.findFirst.mockResolvedValue({
      id: "se-1",
      name: "AH 2025",
      pfsRef: "AW25_OLD",
    });

    const result = await createOrLinkMapping({
      type: "season",
      pfsRef: "AW25_NEW",
      label: "AH 2025",
    });

    expect(result).toEqual({ id: "se-1", name: "AH 2025", created: false });
    expect(mocks.season.create).not.toHaveBeenCalled();
    expect(mocks.loggerWarn.mock.calls[0][0]).toContain("Doublon PFS saison");
  });
});
