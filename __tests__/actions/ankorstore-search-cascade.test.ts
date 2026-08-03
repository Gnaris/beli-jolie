/**
 * Tests de la cascade `searchAndPreviewAnkorstoreByQuery` :
 *   1. GET direct /products/{id} si le produit BJ a déjà un ankorsProductId
 *   2. Sinon → ankorstoreSearchProducts (filter[skuOrName])
 *   3. Fallback ultime → cache complet, uniquement s'il est déjà chaud
 *
 * On mocke les 3 briques (previewAnkorstoreProductForLinking, ankorstoreSearchProducts,
 * getCachedCatalog+filterCatalogEntries) pour vérifier l'ordre d'appel exact.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("next-auth", () => ({
  getServerSession: vi
    .fn()
    .mockResolvedValue({ user: { id: "u", role: "ADMIN", status: "APPROVED" } }),
}));
vi.mock("next/cache", () => ({
  revalidatePath: vi.fn(),
  revalidateTag: vi.fn(),
  unstable_cache: vi.fn((fn: Function) => fn),
}));
vi.mock("@/lib/logger", () => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));
vi.mock("@/lib/tenant", () => ({
  requireCurrentTenant: vi
    .fn()
    .mockResolvedValue({ id: "tenant-1", slug: "bj", name: "BJ" }),
}));

// Prisma
const prismaMock: any = {
  product: {
    findUnique: vi.fn(),
  },
};
vi.mock("@/lib/prisma", () => ({ prisma: prismaMock }));

// Preview Ankorstore (server action utilisée à la fin de chaque branche)
const previewMock = vi.fn();
vi.mock("@/app/actions/admin/ankorstore", () => ({
  previewAnkorstoreProductForLinking: previewMock,
}));

// Endpoints Ankorstore natifs
const ankorApiMock = {
  ankorstoreGetProduct: vi.fn(),
  ankorstoreSearchProducts: vi.fn(),
};
vi.mock("@/lib/ankorstore-api", () => ankorApiMock);

// Cache complet (fallback ultime)
const cacheMock = {
  getCachedCatalog: vi.fn(),
  filterCatalogEntries: vi.fn(),
};
vi.mock("@/lib/ankorstore-catalog-cache", () => cacheMock);

const { searchAndPreviewAnkorstoreByQuery, searchAnkorstoreCandidatesList } = await import(
  "@/app/actions/admin/ankorstore-search"
);

function fakePreviewOk(marketplaceProductId = "ak-123") {
  return {
    success: true as const,
    data: { marketplaceProductId } as any,
  };
}

beforeEach(() => {
  prismaMock.product.findUnique.mockReset();
  previewMock.mockReset();
  ankorApiMock.ankorstoreSearchProducts.mockReset();
  ankorApiMock.ankorstoreGetProduct.mockReset();
  cacheMock.getCachedCatalog.mockReset();
  cacheMock.filterCatalogEntries.mockReset();
});

describe("searchAndPreviewAnkorstoreByQuery — cascade", () => {
  it("étape 1 : produit BJ déjà lié → GET direct par ankorsProductId, pas de recherche", async () => {
    prismaMock.product.findUnique.mockResolvedValueOnce({
      ankorsProductId: "ak-abc",
    });
    previewMock.mockResolvedValueOnce(fakePreviewOk("ak-abc"));

    const res = await searchAndPreviewAnkorstoreByQuery("bj-1", "A405");

    expect(res.success).toBe(true);
    if (!res.success) return;
    expect(res.totalMatches).toBe(1);
    expect(previewMock).toHaveBeenCalledTimes(1);
    expect(previewMock).toHaveBeenCalledWith("bj-1", "ak-abc");
    // Pas de recherche déclenchée
    expect(ankorApiMock.ankorstoreSearchProducts).not.toHaveBeenCalled();
    expect(cacheMock.getCachedCatalog).not.toHaveBeenCalled();
  });

  it("étape 2 : pas d'ankorsProductId → search rapide et prend le 1er candidat", async () => {
    prismaMock.product.findUnique.mockResolvedValueOnce({
      ankorsProductId: null,
    });
    ankorApiMock.ankorstoreSearchProducts.mockResolvedValueOnce([
      { id: "ak-search-1" } as any,
      { id: "ak-search-2" } as any,
    ]);
    previewMock.mockResolvedValueOnce(fakePreviewOk("ak-search-1"));

    const res = await searchAndPreviewAnkorstoreByQuery("bj-1", "A405");

    expect(res.success).toBe(true);
    if (!res.success) return;
    expect(res.totalMatches).toBe(2);
    expect(ankorApiMock.ankorstoreSearchProducts).toHaveBeenCalledWith("A405", 5, {
      skipWideScan: true,
    });
    expect(previewMock).toHaveBeenCalledWith("bj-1", "ak-search-1");
    expect(cacheMock.getCachedCatalog).not.toHaveBeenCalled();
  });

  it("étape 1 échoue (ID obsolète 404) → bascule sur search rapide", async () => {
    prismaMock.product.findUnique.mockResolvedValueOnce({
      ankorsProductId: "ak-stale",
    });
    // Le GET direct renvoie une erreur (ex : produit archivé côté Ankor)
    previewMock.mockResolvedValueOnce({
      success: false,
      error: "Produit Ankorstore introuvable.",
    });
    // La search prend le relais
    ankorApiMock.ankorstoreSearchProducts.mockResolvedValueOnce([
      { id: "ak-fresh" } as any,
    ]);
    previewMock.mockResolvedValueOnce(fakePreviewOk("ak-fresh"));

    const res = await searchAndPreviewAnkorstoreByQuery("bj-1", "A405");

    expect(res.success).toBe(true);
    if (!res.success) return;
    expect(previewMock).toHaveBeenCalledTimes(2);
    expect(previewMock.mock.calls[0][1]).toBe("ak-stale");
    expect(previewMock.mock.calls[1][1]).toBe("ak-fresh");
  });

  it("étape 3 : search vide + cache chaud → fallback cache", async () => {
    prismaMock.product.findUnique.mockResolvedValueOnce({
      ankorsProductId: null,
    });
    ankorApiMock.ankorstoreSearchProducts.mockResolvedValueOnce([]);
    // Cache chaud : catalogue préchargé au boot
    cacheMock.getCachedCatalog.mockReturnValueOnce([
      { id: "ak-cached-1", name: "Foo", ref: "A405", externalId: null } as any,
    ]);
    cacheMock.filterCatalogEntries.mockReturnValueOnce([
      { id: "ak-cached-1", name: "Foo", ref: "A405", externalId: null } as any,
    ]);
    previewMock.mockResolvedValueOnce(fakePreviewOk("ak-cached-1"));

    const res = await searchAndPreviewAnkorstoreByQuery("bj-1", "A405");

    expect(res.success).toBe(true);
    if (!res.success) return;
    expect(previewMock).toHaveBeenCalledWith("bj-1", "ak-cached-1");
  });

  it("étape 3 : cache VIDE (non chargé) → on ne bloque PAS, on renvoie erreur claire", async () => {
    prismaMock.product.findUnique.mockResolvedValueOnce({
      ankorsProductId: null,
    });
    ankorApiMock.ankorstoreSearchProducts.mockResolvedValueOnce([]);
    cacheMock.getCachedCatalog.mockReturnValueOnce(null); // cache pas prêt

    const res = await searchAndPreviewAnkorstoreByQuery("bj-1", "A405");

    expect(res.success).toBe(false);
    if (res.success) return;
    expect(res.error).toMatch(/Aucun produit Ankorstore/i);
    // On ne doit jamais déclencher un chargement complet ici
    expect(cacheMock.filterCatalogEntries).not.toHaveBeenCalled();
  });

  it("rien nulle part (search vide, cache chaud sans match) → erreur claire", async () => {
    prismaMock.product.findUnique.mockResolvedValueOnce({
      ankorsProductId: null,
    });
    ankorApiMock.ankorstoreSearchProducts.mockResolvedValueOnce([]);
    cacheMock.getCachedCatalog.mockReturnValueOnce([{ id: "x" } as any]);
    cacheMock.filterCatalogEntries.mockReturnValueOnce([]);

    const res = await searchAndPreviewAnkorstoreByQuery("bj-1", "ZZZ");

    expect(res.success).toBe(false);
    if (res.success) return;
    expect(res.error).toMatch(/ZZZ/);
    expect(previewMock).not.toHaveBeenCalled();
  });
});

describe("searchAnkorstoreCandidatesList — perf (picker)", () => {
  it("passe skipWideScan: true à ankorstoreSearchProducts (évite le scan 4000 fiches ~30-60s)", async () => {
    // Régression : avant 2026-08-03, le picker appelait avec skipWideScan: false.
    // Résultat : ouvrir la modale sur un produit BJ inconnu d'Ankorstore (ex E598)
    // déclenchait le wide scan → 30-60 s d'attente pour rien.
    ankorApiMock.ankorstoreSearchProducts.mockResolvedValueOnce([]);

    const res = await searchAnkorstoreCandidatesList("E598");

    expect(res.success).toBe(true);
    expect(ankorApiMock.ankorstoreSearchProducts).toHaveBeenCalledWith("E598", 100, {
      skipWideScan: true,
    });
  });
});
