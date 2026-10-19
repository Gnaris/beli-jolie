/**
 * Integration test : à la création d'une collection, les traductions saisies
 * à la main dans le form (EN/DE/IT/ES) sont persistées en base, et l'auto-trad
 * en fond reçoit ces locales en `skipLocales` pour ne pas écraser la saisie.
 *
 * Contexte : 2026-10-17, on a ajouté les 4 champs de langue sur la page de
 * création de collection pour permettre à la cliente d'overrider la trad auto.
 */
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { cleanupTestData, TEST_PREFIX, prisma } from "./setup";

vi.mock("@/lib/storage", async () => {
  const actual = await vi.importActual<typeof import("@/lib/storage")>("@/lib/storage");
  return {
    ...actual,
    deleteFile: vi.fn().mockResolvedValue(undefined),
    renameCollectionFolder: vi.fn().mockResolvedValue({ renamed: [] }),
  };
});

const { createCollection } = await import("@/app/actions/admin/collections");
const { autoTranslateCollection } = await import("@/lib/auto-translate");

describe("Collection create — traductions manuelles (2026-10-17)", () => {
  beforeAll(async () => {
    await cleanupTestData();
  });

  afterAll(async () => {
    await cleanupTestData();
  });

  it("persiste les traductions EN/DE/IT/ES saisies dans le form", async () => {
    const fd = new FormData();
    fd.append("name", `${TEST_PREFIX}Manual trans`);
    fd.append("translation_en", "Manual trans EN");
    fd.append("translation_de", "Manuell DE");
    fd.append("translation_it", "Manuale IT");
    fd.append("translation_es", "Manual ES");

    const result = await createCollection(fd);
    expect(result.success).toBe(true);

    const trans = await prisma.collectionTranslation.findMany({
      where: { collectionId: result.id! },
      select: { locale: true, name: true },
      orderBy: { locale: "asc" },
    });
    expect(trans).toEqual([
      { locale: "de", name: "Manuell DE" },
      { locale: "en", name: "Manual trans EN" },
      { locale: "es", name: "Manual ES" },
      { locale: "it", name: "Manuale IT" },
    ]);
  });

  it("passe les locales saisies en skipLocales à autoTranslateCollection", async () => {
    vi.mocked(autoTranslateCollection).mockClear();

    const fd = new FormData();
    fd.append("name", `${TEST_PREFIX}Skip auto`);
    fd.append("translation_en", "Only EN manual");
    // DE/IT/ES vides → l'auto-trad doit les remplir

    const result = await createCollection(fd);
    expect(result.success).toBe(true);

    expect(autoTranslateCollection).toHaveBeenCalledTimes(1);
    const [, , skipLocales] = vi.mocked(autoTranslateCollection).mock.calls[0];
    expect(skipLocales).toEqual(["en"]);
  });

  it("sans traduction manuelle, skipLocales est vide", async () => {
    vi.mocked(autoTranslateCollection).mockClear();

    const fd = new FormData();
    fd.append("name", `${TEST_PREFIX}Full auto`);

    const result = await createCollection(fd);
    expect(result.success).toBe(true);

    const [, , skipLocales] = vi.mocked(autoTranslateCollection).mock.calls[0];
    expect(skipLocales).toEqual([]);

    const trans = await prisma.collectionTranslation.findMany({
      where: { collectionId: result.id! },
    });
    expect(trans).toHaveLength(0);
  });

  it("ignore les champs vides ou whitespace-only", async () => {
    const fd = new FormData();
    fd.append("name", `${TEST_PREFIX}Whitespace`);
    fd.append("translation_en", "   ");
    fd.append("translation_de", "");
    fd.append("translation_it", "Valido");

    const result = await createCollection(fd);
    expect(result.success).toBe(true);

    const trans = await prisma.collectionTranslation.findMany({
      where: { collectionId: result.id! },
      select: { locale: true, name: true },
    });
    expect(trans).toEqual([{ locale: "it", name: "Valido" }]);
  });
});
