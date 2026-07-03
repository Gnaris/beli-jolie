/**
 * Tests pour `bulkTranslateProducts` — action déclenchée depuis la barre bulk
 * ("Plus > Tout traduire") sur la page /admin/produits.
 *
 * Comportements couverts :
 *  - traduit chaque produit sélectionné (nom + description) vers l'anglais et
 *    upsert la ProductTranslation existante (force overwrite),
 *  - compte séparément traduit / échec (translateTextStrict → null) / ignoré
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
}));

const translateTextStrictMock = vi.fn();
vi.mock("@/lib/translate", () => ({
  invalidateProductTranslations: vi.fn(),
  translateTextStrict: (...args: unknown[]) => translateTextStrictMock(...args),
}));

// Bruit de fond — modules importés par products.ts non exercés ici.
vi.mock("@/lib/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));
vi.mock("@/lib/notifications", () => ({ notifyRestockAlerts: vi.fn() }));
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
vi.mock("@/i18n/locales", () => ({ NON_DEFAULT_LOCALES: ["en"] }));

import { prisma } from "@/lib/prisma";
import { bulkTranslateProducts } from "@/app/actions/admin/products";

const findManyMock = prisma.product.findMany as unknown as ReturnType<typeof vi.fn>;
const upsertMock = prisma.productTranslation.upsert as unknown as ReturnType<typeof vi.fn>;

describe("bulkTranslateProducts", () => {
  beforeEach(() => {
    findManyMock.mockReset();
    upsertMock.mockReset().mockResolvedValue({});
    translateTextStrictMock.mockReset();
  });

  it("liste vide → aucun appel translate ni upsert", async () => {
    const res = await bulkTranslateProducts([]);
    expect(res).toEqual({ translated: 0, failed: 0, skipped: 0 });
    expect(findManyMock).not.toHaveBeenCalled();
    expect(translateTextStrictMock).not.toHaveBeenCalled();
    expect(upsertMock).not.toHaveBeenCalled();
  });

  it("traduit chaque produit et upsert en 'en' (force overwrite via update)", async () => {
    findManyMock.mockResolvedValue([
      { id: "p1", name: "Bague émeraude", description: "Une bague fine." },
      { id: "p2", name: "Collier or", description: "Chaîne dorée." },
    ]);
    // translateTextStrict est appelé 4 fois : name+description × 2 produits.
    translateTextStrictMock
      .mockResolvedValueOnce("Emerald ring")
      .mockResolvedValueOnce("A thin ring.")
      .mockResolvedValueOnce("Gold necklace")
      .mockResolvedValueOnce("Gold-plated chain.");

    const res = await bulkTranslateProducts(["p1", "p2"]);

    expect(res).toEqual({ translated: 2, failed: 0, skipped: 0 });
    expect(upsertMock).toHaveBeenCalledTimes(2);
    // Le premier upsert (ordre garanti par Promise.all + slice concurrency=5).
    const firstCall = upsertMock.mock.calls.find(
      ([arg]) => arg.where.productId_locale.productId === "p1",
    )?.[0];
    expect(firstCall).toBeDefined();
    expect(firstCall.where.productId_locale.locale).toBe("en");
    expect(firstCall.update).toEqual({ name: "Emerald ring", description: "A thin ring." });
    expect(firstCall.create).toEqual({
      productId: "p1",
      locale: "en",
      name: "Emerald ring",
      description: "A thin ring.",
    });
  });

  it("nom FR vide → produit compté 'skipped' sans appel translate", async () => {
    findManyMock.mockResolvedValue([
      { id: "p1", name: "   ", description: "Description quelconque." },
    ]);

    const res = await bulkTranslateProducts(["p1"]);

    expect(res).toEqual({ translated: 0, failed: 0, skipped: 1 });
    expect(translateTextStrictMock).not.toHaveBeenCalled();
    expect(upsertMock).not.toHaveBeenCalled();
  });

  it("translate name → null (retry exhausted) → produit compté 'failed', pas d'upsert", async () => {
    findManyMock.mockResolvedValue([
      { id: "p1", name: "Bague émeraude", description: "Une bague fine." },
    ]);
    translateTextStrictMock
      .mockResolvedValueOnce(null) // name → null = échec dur
      .mockResolvedValueOnce("A thin ring.");

    const res = await bulkTranslateProducts(["p1"]);

    expect(res).toEqual({ translated: 0, failed: 1, skipped: 0 });
    expect(upsertMock).not.toHaveBeenCalled();
  });

  it("description vide côté FR → upsert avec description='' sans appel translate pour la desc", async () => {
    findManyMock.mockResolvedValue([
      { id: "p1", name: "Bague émeraude", description: null },
    ]);
    translateTextStrictMock.mockResolvedValueOnce("Emerald ring");

    const res = await bulkTranslateProducts(["p1"]);

    expect(res).toEqual({ translated: 1, failed: 0, skipped: 0 });
    // 1 seul appel translate (pour le nom).
    expect(translateTextStrictMock).toHaveBeenCalledTimes(1);
    expect(upsertMock).toHaveBeenCalledWith(
      expect.objectContaining({
        update: { name: "Emerald ring", description: "" },
        create: expect.objectContaining({ description: "" }),
      }),
    );
  });
});
