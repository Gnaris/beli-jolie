/**
 * Tests pour `bulkTranslateProducts` — action déclenchée depuis la barre bulk
 * ("Plus > Tout traduire") sur la page /admin/produits.
 *
 * Comportements couverts :
 *  - traduit chaque produit sélectionné (nom + description) vers TOUTES les
 *    locales non-FR du site (en, de, it, es) en 1 seul appel PFS par batch,
 *  - upsert la ProductTranslation existante par (productId, locale) (force
 *    overwrite),
 *  - compte séparément traduit / échec (translatePhrases → null) / ignoré
 *    (nom vide côté FR),
 *  - liste vide → retour {0,0,0} sans appel translate ni upsert.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/prisma", () => ({
  prisma: {
    product: { findMany: vi.fn() },
    productTranslation: { upsert: vi.fn().mockResolvedValue({}) },
  },
}));

vi.mock("next-auth", () => ({
  getServerSession: vi.fn().mockResolvedValue({ user: { role: "ADMIN" } }),
}));
vi.mock("@/lib/auth", () => ({ authOptions: {} }));

vi.mock("next/cache", () => ({
  revalidatePath: vi.fn(),
  revalidateTag: vi.fn(),
  unstable_cache: <T,>(fn: T) => fn,
}));

vi.mock("@/lib/translate", () => ({
  invalidateProductTranslations: vi.fn(),
  translateTextStrict: vi.fn(),
}));

const translatePhrasesMock = vi.fn();
vi.mock("@/lib/pfs-translate", () => ({
  translatePhrases: (...args: unknown[]) => translatePhrasesMock(...args),
  PFS_TRANSLATION_LOCALES: ["fr", "en", "de", "es", "it"] as const,
}));

// Bruit de fond — modules importés par products.ts non exercés ici.
vi.mock("@/lib/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));
vi.mock("@/lib/notifications", () => ({}));
vi.mock("@/lib/auto-translate", () => ({
  autoTranslateProduct: vi.fn(),
  autoTranslateTag: vi.fn(),
}));
vi.mock("@/lib/sku", () => ({ generateSku: vi.fn() }));
vi.mock("@/lib/image-utils", () => ({ getImagePaths: vi.fn() }));
vi.mock("@/lib/pfs-annexes", () => ({ getPfsAnnexes: vi.fn() }));
vi.mock("@/lib/normalize-primary-flag", () => ({ normalizePrimaryFlag: vi.fn() }));
vi.mock("@/lib/variant-image-coverage", () => ({ anyVariantHasImage: vi.fn(() => true) }));
vi.mock("@/lib/product-primary-color", () => ({
  resolvePrimaryColorId: vi.fn(),
  listAvailableColorIds: vi.fn(),
}));
vi.mock("@/lib/pfs-color-conflicts", () => ({
  validateOverridesNotMatchingPrincipal: vi.fn(),
}));
vi.mock("@/i18n/locales", () => ({ NON_DEFAULT_LOCALES: ["en", "de", "it", "es"] }));

import { prisma } from "@/lib/prisma";
import { bulkTranslateProducts } from "@/app/actions/admin/products";

const findManyMock = prisma.product.findMany as unknown as ReturnType<typeof vi.fn>;
const upsertMock = prisma.productTranslation.upsert as unknown as ReturnType<typeof vi.fn>;

describe("bulkTranslateProducts", () => {
  beforeEach(() => {
    findManyMock.mockReset();
    upsertMock.mockReset().mockResolvedValue({});
    translatePhrasesMock.mockReset();
  });

  it("liste vide → aucun appel translate ni upsert", async () => {
    const res = await bulkTranslateProducts([]);
    expect(res).toEqual({ translated: 0, failed: 0, skipped: 0 });
    expect(findManyMock).not.toHaveBeenCalled();
    expect(translatePhrasesMock).not.toHaveBeenCalled();
    expect(upsertMock).not.toHaveBeenCalled();
  });

  it("traduit chaque produit vers EN+DE+IT+ES et upsert par locale", async () => {
    findManyMock.mockResolvedValue([
      { id: "p1", name: "Bague émeraude", description: "Une bague fine." },
    ]);
    translatePhrasesMock.mockResolvedValueOnce({
      n_p1: {
        en: "Emerald ring",
        de: "Smaragdring",
        it: "Anello smeraldo",
        es: "Anillo esmeralda",
      },
      d_p1: {
        en: "A thin ring.",
        de: "Ein feiner Ring.",
        it: "Un anello fine.",
        es: "Un anillo fino.",
      },
    });

    const res = await bulkTranslateProducts(["p1"]);

    expect(res).toEqual({ translated: 1, failed: 0, skipped: 0 });
    // 1 upsert par locale (4 locales non-FR).
    expect(upsertMock).toHaveBeenCalledTimes(4);
    const locales = upsertMock.mock.calls.map(
      ([arg]) => arg.where.productId_locale.locale,
    );
    expect(locales.sort()).toEqual(["de", "en", "es", "it"]);

    // Vérifie que la payload DE est correcte.
    const deCall = upsertMock.mock.calls.find(
      ([arg]) => arg.where.productId_locale.locale === "de",
    )?.[0];
    expect(deCall.update).toEqual({ name: "Smaragdring", description: "Ein feiner Ring." });
    expect(deCall.create).toEqual({
      productId: "p1",
      locale: "de",
      name: "Smaragdring",
      description: "Ein feiner Ring.",
    });
  });

  it("nom FR vide → produit compté 'skipped' sans appel translate", async () => {
    findManyMock.mockResolvedValue([
      { id: "p1", name: "   ", description: "Description quelconque." },
    ]);

    const res = await bulkTranslateProducts(["p1"]);

    expect(res).toEqual({ translated: 0, failed: 0, skipped: 1 });
    expect(translatePhrasesMock).not.toHaveBeenCalled();
    expect(upsertMock).not.toHaveBeenCalled();
  });

  it("translatePhrases → null (retry exhausted) → tout le batch compté 'failed'", async () => {
    findManyMock.mockResolvedValue([
      { id: "p1", name: "Bague émeraude", description: "Une bague fine." },
      { id: "p2", name: "Collier or", description: "Chaîne dorée." },
    ]);
    translatePhrasesMock.mockResolvedValueOnce(null);

    const res = await bulkTranslateProducts(["p1", "p2"]);

    expect(res).toEqual({ translated: 0, failed: 2, skipped: 0 });
    expect(upsertMock).not.toHaveBeenCalled();
  });

  it("description vide côté FR → traduction du nom seul, desc=''", async () => {
    findManyMock.mockResolvedValue([
      { id: "p1", name: "Bague émeraude", description: null },
    ]);
    translatePhrasesMock.mockResolvedValueOnce({
      n_p1: {
        en: "Emerald ring",
        de: "Smaragdring",
        it: "Anello smeraldo",
        es: "Anillo esmeralda",
      },
    });

    const res = await bulkTranslateProducts(["p1"]);

    expect(res).toEqual({ translated: 1, failed: 0, skipped: 0 });
    // La clé d_p1 n'a pas été envoyée (description vide).
    const sentPhrases = translatePhrasesMock.mock.calls[0][0] as Record<string, string>;
    expect(Object.keys(sentPhrases)).toEqual(["n_p1"]);
    // Chaque locale est upsert avec description="".
    expect(upsertMock).toHaveBeenCalledTimes(4);
    for (const call of upsertMock.mock.calls) {
      expect(call[0].update.description).toBe("");
      expect(call[0].create.description).toBe("");
    }
  });

  it("produit sans aucune locale renvoyée par PFS → compté 'failed'", async () => {
    findManyMock.mockResolvedValue([
      { id: "p1", name: "Bague émeraude", description: "Une bague fine." },
    ]);
    translatePhrasesMock.mockResolvedValueOnce({
      // PFS renvoie une entrée vide (aucune traduction).
      n_p1: {},
      d_p1: {},
    });

    const res = await bulkTranslateProducts(["p1"]);

    expect(res).toEqual({ translated: 0, failed: 1, skipped: 0 });
    expect(upsertMock).not.toHaveBeenCalled();
  });
});
