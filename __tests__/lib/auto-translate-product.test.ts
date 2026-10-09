/**
 * Tests pour l'auto-traduction produit étendue à toutes les locales.
 *
 * Couverture :
 *  1. Les 4 locales (EN/DE/IT/ES) sont traduites en 1 seul appel PFS.
 *  2. Les locales fournies via `existingLocales` sont skippées.
 *  3. Les locales avec `manualEdit:true` en BDD sont skippées.
 *  4. Rien n'est écrit si `auto_translate_enabled=false`.
 *  5. Rien n'est écrit si l'appel PFS échoue (translatePhrases → null).
 *  6. Les traductions vides ou identiques au FR ne sont pas enregistrées.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

const prismaMock = {
  siteConfig: {
    findFirst: vi.fn(),
  },
  productTranslation: {
    findMany: vi.fn(),
    upsert: vi.fn(),
  },
};

vi.mock("@/lib/prisma", () => ({ prisma: prismaMock }));

vi.mock("@/lib/logger", () => ({
  logger: { warn: vi.fn(), info: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

function setAutoTranslate(enabled: boolean) {
  prismaMock.siteConfig.findFirst.mockImplementation(
    async ({ where }: { where: { key: string } }) => {
      if (where.key === "auto_translate_enabled") {
        return { value: enabled ? "true" : "false" };
      }
      return null;
    },
  );
}

/** Mock PFS translatePhrases pour renvoyer un dict figé des 4 langues. */
function mockTranslatePhrases(returnValue: unknown) {
  vi.doMock("@/lib/pfs-translate", async () => {
    const actual =
      await vi.importActual<typeof import("@/lib/pfs-translate")>("@/lib/pfs-translate");
    return {
      ...actual,
      translatePhrases: vi.fn(async () => returnValue),
    };
  });
}

const FULL_PFS_RESULT = {
  name: {
    fr: "Collier perles",
    en: "Pearl necklace",
    de: "Perlenkette",
    it: "Collana di perle",
    es: "Collar de perlas",
  },
  description: {
    fr: "Un joli collier",
    en: "A nice necklace",
    de: "Eine schöne Kette",
    it: "Una bella collana",
    es: "Un bonito collar",
  },
};

describe("autoTranslateProduct — extension 4 langues", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    setAutoTranslate(true);
    prismaMock.productTranslation.findMany.mockResolvedValue([]);
    prismaMock.productTranslation.upsert.mockResolvedValue({});
  });

  it("traduit EN/DE/IT/ES en 1 seul appel PFS quand aucune locale n'est verrouillée", async () => {
    const translatePhrasesMock = vi.fn(async () => FULL_PFS_RESULT);
    vi.doMock("@/lib/pfs-translate", async () => {
      const actual =
        await vi.importActual<typeof import("@/lib/pfs-translate")>(
          "@/lib/pfs-translate",
        );
      return { ...actual, translatePhrases: translatePhrasesMock };
    });

    const { autoTranslateProduct } = await import("@/lib/auto-translate");
    autoTranslateProduct("prod-1", "Collier perles", "Un joli collier", []);
    // fire-and-forget : attendre micro-tick
    await new Promise((r) => setImmediate(r));

    expect(translatePhrasesMock).toHaveBeenCalledTimes(1);
    const upsertCalls = prismaMock.productTranslation.upsert.mock.calls;
    const locales = upsertCalls
      .map((c) => c[0].where.productId_locale.locale)
      .sort();
    expect(locales).toEqual(["de", "en", "es", "it"]);
  });

  it("skip les locales fournies via existingLocales", async () => {
    const translatePhrasesMock = vi.fn(async () => FULL_PFS_RESULT);
    vi.doMock("@/lib/pfs-translate", async () => {
      const actual =
        await vi.importActual<typeof import("@/lib/pfs-translate")>(
          "@/lib/pfs-translate",
        );
      return { ...actual, translatePhrases: translatePhrasesMock };
    });

    const { autoTranslateProduct } = await import("@/lib/auto-translate");
    autoTranslateProduct("prod-2", "Collier perles", "Un joli collier", [
      "en",
      "de",
    ]);
    await new Promise((r) => setImmediate(r));

    const upsertCalls = prismaMock.productTranslation.upsert.mock.calls;
    const locales = upsertCalls
      .map((c) => c[0].where.productId_locale.locale)
      .sort();
    expect(locales).toEqual(["es", "it"]);
  });

  it("skip les locales avec manualEdit:true en BDD", async () => {
    prismaMock.productTranslation.findMany.mockResolvedValue([
      { locale: "en" },
      { locale: "it" },
    ]);
    const translatePhrasesMock = vi.fn(async () => FULL_PFS_RESULT);
    vi.doMock("@/lib/pfs-translate", async () => {
      const actual =
        await vi.importActual<typeof import("@/lib/pfs-translate")>(
          "@/lib/pfs-translate",
        );
      return { ...actual, translatePhrases: translatePhrasesMock };
    });

    const { autoTranslateProduct } = await import("@/lib/auto-translate");
    autoTranslateProduct("prod-3", "Collier perles", "Un joli collier", []);
    await new Promise((r) => setImmediate(r));

    const upsertCalls = prismaMock.productTranslation.upsert.mock.calls;
    const locales = upsertCalls
      .map((c) => c[0].where.productId_locale.locale)
      .sort();
    expect(locales).toEqual(["de", "es"]);
  });

  it("ne fait rien si auto_translate_enabled=false", async () => {
    setAutoTranslate(false);
    const translatePhrasesMock = vi.fn(async () => FULL_PFS_RESULT);
    vi.doMock("@/lib/pfs-translate", async () => {
      const actual =
        await vi.importActual<typeof import("@/lib/pfs-translate")>(
          "@/lib/pfs-translate",
        );
      return { ...actual, translatePhrases: translatePhrasesMock };
    });

    const { autoTranslateProduct } = await import("@/lib/auto-translate");
    autoTranslateProduct("prod-4", "Collier perles", "Un joli collier", []);
    await new Promise((r) => setImmediate(r));

    expect(translatePhrasesMock).not.toHaveBeenCalled();
    expect(prismaMock.productTranslation.upsert).not.toHaveBeenCalled();
  });

  it("n'écrit rien si translatePhrases retourne null (API HS)", async () => {
    const translatePhrasesMock = vi.fn(async () => null);
    vi.doMock("@/lib/pfs-translate", async () => {
      const actual =
        await vi.importActual<typeof import("@/lib/pfs-translate")>(
          "@/lib/pfs-translate",
        );
      return { ...actual, translatePhrases: translatePhrasesMock };
    });

    const { autoTranslateProduct } = await import("@/lib/auto-translate");
    autoTranslateProduct("prod-5", "Collier perles", "Un joli collier", []);
    await new Promise((r) => setImmediate(r));

    expect(prismaMock.productTranslation.upsert).not.toHaveBeenCalled();
  });

  it("skip une locale si la trad du nom est identique au FR (traduction PFS ratée)", async () => {
    const translatePhrasesMock = vi.fn(async () => ({
      name: {
        fr: "Collier",
        en: "Collier", // identique au FR → skip
        de: "Halskette",
        it: "Collier", // identique → skip
        es: "Collar",
      },
      description: {
        fr: "Un collier",
        en: "A necklace",
        de: "Eine Kette",
        it: "Una collana",
        es: "Un collar",
      },
    }));
    vi.doMock("@/lib/pfs-translate", async () => {
      const actual =
        await vi.importActual<typeof import("@/lib/pfs-translate")>(
          "@/lib/pfs-translate",
        );
      return { ...actual, translatePhrases: translatePhrasesMock };
    });

    const { autoTranslateProduct } = await import("@/lib/auto-translate");
    autoTranslateProduct("prod-6", "Collier", "Un collier", []);
    await new Promise((r) => setImmediate(r));

    const upsertCalls = prismaMock.productTranslation.upsert.mock.calls;
    const locales = upsertCalls
      .map((c) => c[0].where.productId_locale.locale)
      .sort();
    expect(locales).toEqual(["de", "es"]);
  });
});
