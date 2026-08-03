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

  it("étape 2 : cache chaud → filtrage in-memory, PAS d'appel API", async () => {
    // Le cache est préchargé au boot pm2 (~10 000 produits BJ, reload 6h).
    // Filtrage in-memory = quelques ms là où l'API `filter[skuOrName]` prend
    // 30-40 s par appel — et rate les SKUs à underscore comme E598_DORE_UNIT_4.
    prismaMock.product.findUnique.mockResolvedValueOnce({
      ankorsProductId: null,
    });
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
    // Pas de fallback API si le cache trouve
    expect(ankorApiMock.ankorstoreSearchProducts).not.toHaveBeenCalled();
  });

  it("étape 1 échoue (ID obsolète 404) → bascule sur cache puis search", async () => {
    prismaMock.product.findUnique.mockResolvedValueOnce({
      ankorsProductId: "ak-stale",
    });
    // Le GET direct renvoie une erreur (ex : produit archivé côté Ankor)
    previewMock.mockResolvedValueOnce({
      success: false,
      error: "Produit Ankorstore introuvable.",
    });
    // Cache pas prêt (ex : PM2 restart récent)
    cacheMock.getCachedCatalog.mockReturnValueOnce(null);
    // La search prend le relais avec un vrai match (name inclut A405)
    ankorApiMock.ankorstoreSearchProducts.mockResolvedValueOnce([
      { id: "ak-fresh", name: "Boucles A405", variants: [{ sku: "A405_OR" }] } as any,
    ]);
    previewMock.mockResolvedValueOnce(fakePreviewOk("ak-fresh"));

    const res = await searchAndPreviewAnkorstoreByQuery("bj-1", "A405");

    expect(res.success).toBe(true);
    if (!res.success) return;
    expect(previewMock).toHaveBeenCalledTimes(2);
    expect(previewMock.mock.calls[0][1]).toBe("ak-stale");
    expect(previewMock.mock.calls[1][1]).toBe("ak-fresh");
  });

  it("étape 3 : cache froid + search API prend le relais avec skipWideScan false (SKU à underscore)", async () => {
    // Ce test verrouille le fait qu'on garde le wide scan comme dernier recours
    // pour les SKUs comme E598_DORE_UNIT_4 que le tokenizer Ankorstore ignore.
    prismaMock.product.findUnique.mockResolvedValueOnce({
      ankorsProductId: null,
    });
    cacheMock.getCachedCatalog.mockReturnValueOnce(null); // cache pas prêt
    ankorApiMock.ankorstoreSearchProducts.mockResolvedValueOnce([
      { id: "ak-scan-found", name: "Bracelet E598", variants: [{ sku: "E598_DORE_UNIT_4" }] } as any,
    ]);
    previewMock.mockResolvedValueOnce(fakePreviewOk("ak-scan-found"));

    const res = await searchAndPreviewAnkorstoreByQuery("bj-1", "E598");

    expect(res.success).toBe(true);
    expect(ankorApiMock.ankorstoreSearchProducts).toHaveBeenCalledWith("E598", 20, {
      skipWideScan: false,
    });
  });

  it("cache chaud sans match + API vide → erreur claire", async () => {
    prismaMock.product.findUnique.mockResolvedValueOnce({
      ankorsProductId: null,
    });
    cacheMock.getCachedCatalog.mockReturnValueOnce([{ id: "x" } as any]);
    cacheMock.filterCatalogEntries.mockReturnValueOnce([]);
    ankorApiMock.ankorstoreSearchProducts.mockResolvedValueOnce([]);

    const res = await searchAndPreviewAnkorstoreByQuery("bj-1", "ZZZ");

    expect(res.success).toBe(false);
    if (res.success) return;
    expect(res.error).toMatch(/ZZZ/);
    expect(previewMock).not.toHaveBeenCalled();
  });

  it("filtre les parasites Ankorstore dans le fallback preview (bug A164 → A670)", async () => {
    // Régression 2026-08-03 : si toutes les fiches renvoyées par l'API sont
    // des parasites (score 10), on ne doit PAS charger la 1ʳᵉ comme preview.
    // Sans filtre, chercher A164 chargeait la preview d'A670 en 1er, exposant
    // à l'admin des variants d'un produit sans rapport.
    prismaMock.product.findUnique.mockResolvedValueOnce({
      ankorsProductId: null,
    });
    cacheMock.getCachedCatalog.mockReturnValueOnce(null);
    ankorApiMock.ankorstoreSearchProducts.mockResolvedValueOnce([
      // Parasites : rien ne matche « a164 » → score 10 chacun
      { id: "ak-a670", name: "Boucles d'oreilles en acier inoxydable", variants: [{ sku: "A670_DORE" }] } as any,
      { id: "ak-a687", name: "Boucles d'oreilles en acier inoxydable", variants: [{ sku: "A687_ARGENT" }] } as any,
    ]);

    const res = await searchAndPreviewAnkorstoreByQuery("bj-1", "A164");

    expect(res.success).toBe(false);
    if (res.success) return;
    expect(res.error).toMatch(/A164/);
    // La preview du parasite A670 ne doit JAMAIS être chargée
    expect(previewMock).not.toHaveBeenCalled();
  });
});

describe("searchAnkorstoreCandidatesList — cache-first (picker)", () => {
  it("cache chaud → renvoie les matches sans appeler l'API (rapide)", async () => {
    // Le picker doit filtrer le cache in-memory avant tout appel API.
    // Bug 2026-08-03 : sans cache-first, ouvrir la modale sur E598
    // déclenchait 30-40 s de filter[skuOrName] à Ankorstore.
    cacheMock.getCachedCatalog.mockReturnValueOnce([
      {
        id: "ak-e598",
        name: "Boucles E598",
        ref: "E598",
        externalId: "E598",
        firstImageUrl: null,
        variantCount: 2,
      } as any,
    ]);
    cacheMock.filterCatalogEntries.mockReturnValueOnce([
      {
        id: "ak-e598",
        name: "Boucles E598",
        ref: "E598",
        externalId: "E598",
        firstImageUrl: null,
        variantCount: 2,
      } as any,
    ]);

    const res = await searchAnkorstoreCandidatesList("E598");

    expect(res.success).toBe(true);
    if (!res.success) return;
    expect(res.data.candidates).toHaveLength(1);
    expect(res.data.candidates[0].id).toBe("ak-e598");
    // Aucun appel API tant que le cache répond
    expect(ankorApiMock.ankorstoreSearchProducts).not.toHaveBeenCalled();
  });

  it("cache froid (PM2 restart) → retombe sur l'API avec skipWideScan false", async () => {
    // Wide scan reste actif comme dernier recours pour les SKUs à underscore
    // (E598_DORE_UNIT_4) que le tokenizer Ankorstore ignore.
    cacheMock.getCachedCatalog.mockReturnValueOnce(null); // cache pas prêt
    ankorApiMock.ankorstoreSearchProducts.mockResolvedValueOnce([]);

    const res = await searchAnkorstoreCandidatesList("E598");

    expect(res.success).toBe(true);
    expect(ankorApiMock.ankorstoreSearchProducts).toHaveBeenCalledWith("E598", 100, {
      skipWideScan: false,
    });
  });

  it("filtre les parasites Ankorstore (score 10 = match indirect sans rapport)", async () => {
    // Bug 2026-08-03 : chercher A164 remontait A687, ZB09A, P14 en fond de
    // picker parce qu'Ankorstore renvoie des produits qui n'ont rien à voir
    // avec la requête. Le scoring leur donne 10 (« match indirect »). On
    // les exclut du picker (seuil minimum = 20).
    cacheMock.getCachedCatalog.mockReturnValueOnce(null); // cache pas prêt
    ankorApiMock.ankorstoreSearchProducts.mockResolvedValueOnce([
      // Match légitime : SKU contient A164
      { id: "ak-a164", name: "Bracelet A164", variants: [{ sku: "A164_OR" }], images: [], externalId: "A164" } as any,
      // Parasite Ankorstore : rien ne matche « a164 » → score 10
      { id: "ak-a687", name: "Bague A687", variants: [{ sku: "A687_ARGENT" }], images: [], externalId: "A687" } as any,
      { id: "ak-zb09a", name: "Collier ZB09A", variants: [{ sku: "ZB09A_ROSE" }], images: [], externalId: "ZB09A" } as any,
    ]);

    const res = await searchAnkorstoreCandidatesList("A164");

    expect(res.success).toBe(true);
    if (!res.success) return;
    expect(res.data.candidates).toHaveLength(1);
    expect(res.data.candidates[0].id).toBe("ak-a164");
  });
});
