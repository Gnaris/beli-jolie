import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * Auto-création pendant l'import PFS : pour chaque type d'attribut
 * (composition, pays, saison, taille, couleur, catégorie), si aucune entité
 * locale ne correspond, on doit créer la nouvelle ligne BDD avec son
 * `pfs*Ref` rempli — c'est ce qui remplace l'ancienne phase de scan +
 * validation manuelle des correspondances.
 *
 * On teste `createOrLinkMapping` directement (cas "rien en local → create").
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
  categoryTranslation: { upsert: vi.fn() },
  colorTranslation: { upsert: vi.fn() },
  compositionTranslation: { upsert: vi.fn() },
  manufacturingCountryTranslation: { upsert: vi.fn() },
  seasonTranslation: { upsert: vi.fn() },
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
    categoryTranslation: mocks.categoryTranslation,
    colorTranslation: mocks.colorTranslation,
    compositionTranslation: mocks.compositionTranslation,
    manufacturingCountryTranslation: mocks.manufacturingCountryTranslation,
    seasonTranslation: mocks.seasonTranslation,
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

describe("Auto-création des attributs PFS pendant l'import", () => {
  it("composition : aucune entité locale → create avec pfsCompositionRef", async () => {
    mocks.composition.findFirst.mockResolvedValue(null);
    mocks.composition.create.mockResolvedValue({ id: "co-new", name: "Métal" });

    const result = await createOrLinkMapping({
      type: "composition",
      pfsRef: "Métal",
      label: "Métal",
      enLabel: "Metal",
    });

    expect(result).toEqual({ id: "co-new", name: "Métal", created: true });
    expect(mocks.composition.create).toHaveBeenCalledWith({
      data: { name: "Métal", pfsCompositionRef: "Métal" },
      select: { id: true, name: true },
    });
    expect(mocks.compositionTranslation.upsert).toHaveBeenCalled();
  });

  it("pays : aucune entité locale → create avec pfsCountryRef + isoCode", async () => {
    mocks.manufacturingCountry.findFirst.mockResolvedValue(null);
    mocks.manufacturingCountry.create.mockResolvedValue({ id: "ctry-new", name: "Chine" });

    const result = await createOrLinkMapping({
      type: "country",
      pfsRef: "Chine",
      label: "Chine",
      enLabel: "China",
      isoCode: "CN",
    });

    expect(result).toEqual({ id: "ctry-new", name: "Chine", created: true });
    expect(mocks.manufacturingCountry.create).toHaveBeenCalledWith({
      data: { name: "Chine", pfsCountryRef: "Chine", isoCode: "CN" },
      select: { id: true, name: true },
    });
  });

  it("pays : isoCode invalide → ignoré (null)", async () => {
    mocks.manufacturingCountry.findFirst.mockResolvedValue(null);
    mocks.manufacturingCountry.create.mockResolvedValue({ id: "ctry-x", name: "Inconnu" });

    await createOrLinkMapping({
      type: "country",
      pfsRef: "Inconnu",
      label: "Inconnu",
      isoCode: "XYZ", // invalide (3 lettres)
    });

    expect(mocks.manufacturingCountry.create).toHaveBeenCalledWith({
      data: { name: "Inconnu", pfsCountryRef: "Inconnu", isoCode: null },
      select: { id: true, name: true },
    });
  });

  it("saison : aucune entité locale → create avec pfsRef", async () => {
    mocks.season.findFirst.mockResolvedValue(null);
    mocks.season.create.mockResolvedValue({ id: "sea-new", name: "PE 2026" });

    const result = await createOrLinkMapping({
      type: "season",
      pfsRef: "PE26",
      label: "PE 2026",
    });

    expect(result).toEqual({ id: "sea-new", name: "PE 2026", created: true });
    expect(mocks.season.create).toHaveBeenCalledWith({
      data: { name: "PE 2026", pfsRef: "PE26" },
      select: { id: true, name: true },
    });
  });

  it("taille : aucune entité locale → create avec pfsSizeRef", async () => {
    mocks.size.findFirst.mockResolvedValue(null);
    mocks.size.create.mockResolvedValue({ id: "sz-new", name: "M" });

    const result = await createOrLinkMapping({
      type: "size",
      pfsRef: "M",
      label: "M",
    });

    expect(result).toEqual({ id: "sz-new", name: "M", created: true });
    expect(mocks.size.create).toHaveBeenCalledWith({
      data: { name: "M", pfsSizeRef: "M" },
      select: { id: true, name: true },
    });
  });

  it("taille TU : si Taille unique absente → crée Taille unique (pas TU)", async () => {
    mocks.size.findFirst.mockResolvedValue(null);
    mocks.size.create.mockResolvedValue({ id: "tu-new", name: "Taille unique" });

    const result = await createOrLinkMapping({
      type: "size",
      pfsRef: "TU",
      label: "TU",
    });

    expect(result).toEqual({ id: "tu-new", name: "Taille unique", created: true });
    expect(mocks.size.create).toHaveBeenCalledWith({
      data: { name: "Taille unique", pfsSizeRef: "TU", position: 0 },
      select: { id: true, name: true },
    });
  });

  it("couleur : aucune entité locale → create avec hex + pfsColorRef", async () => {
    mocks.color.findFirst.mockResolvedValue(null);
    mocks.color.create.mockResolvedValue({ id: "col-new", name: "Métal" });

    const result = await createOrLinkMapping({
      type: "color",
      pfsRef: "METAL",
      label: "Métal",
      enLabel: "Metal",
      hex: "#cccccc",
    });

    expect(result).toEqual({ id: "col-new", name: "Métal", created: true });
    expect(mocks.color.create).toHaveBeenCalledWith({
      data: { name: "Métal", hex: "#cccccc", pfsColorRef: "METAL" },
      select: { id: true, name: true },
    });
  });

  it("catégorie : aucune entité locale → create avec pfsCategoryId, slug, méta", async () => {
    mocks.category.findFirst
      .mockResolvedValueOnce(null) // by pfsCategoryId
      .mockResolvedValueOnce(null); // by name
    mocks.category.create.mockResolvedValue({ id: "cat-new", name: "Bracelets" });

    const result = await createOrLinkMapping({
      type: "category",
      pfsRef: "PFS_BRACELETS_ID",
      label: "Bracelets",
      enLabel: "Bracelets",
      pfsGender: "WOMAN",
      pfsFamilyName: "Bijoux_Fantaisie",
      pfsCategoryName: "Bracelets",
    });

    expect(result).toEqual({ id: "cat-new", name: "Bracelets", created: true });
    expect(mocks.category.create).toHaveBeenCalled();
    const createArg = mocks.category.create.mock.calls[0][0];
    expect(createArg.data).toMatchObject({
      name: "Bracelets",
      slug: "bracelets",
      pfsCategoryId: "PFS_BRACELETS_ID",
      pfsCategoryName: "Bracelets",
    });
  });
});
