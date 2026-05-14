/**
 * Tests du module `lib/ankorstore-catalog-cache.ts` :
 * - filtrage local insensible casse/accents
 * - cache frais / expiré / invalidation
 * - partage de promesse en cas d'appels concurrents
 * - progression envoyée à chaque page chargée
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

// Stub de ankorstore-api : on contrôle ce que renvoie ankorstoreListAllProducts.
// vi.mock est hoisté → on passe par vi.hoisted pour exposer le mock au test.
const { listAllMock } = vi.hoisted(() => ({ listAllMock: vi.fn() }));
vi.mock("@/lib/ankorstore-api", () => ({
  ankorstoreListAllProducts: listAllMock,
}));

import {
  filterCatalogEntries,
  loadFullCatalog,
  getCachedCatalog,
  getCatalogStatus,
  invalidateCatalogCache,
  __resetCatalogCacheForTests,
  type CatalogEntry,
} from "@/lib/ankorstore-catalog-cache";

function makeProduct(opts: {
  id: string;
  name: string;
  externalId?: string | null;
  variantSkus?: string[];
}) {
  return {
    id: opts.id,
    externalId: opts.externalId ?? null,
    name: opts.name,
    description: "",
    retailPrice: 20,
    wholesalePrice: 10,
    vatRate: 20,
    active: true,
    archived: false,
    images: [],
    variants: (opts.variantSkus ?? []).map((sku, i) => ({
      id: `${opts.id}-v${i}`,
      sku,
      ian: null,
      name: sku,
      retailPrice: 20,
      wholesalePrice: 10,
      availableQuantity: 1,
      stockQuantity: 1,
      isAlwaysInStock: false,
    })),
  };
}

function entryFor(id: string, name: string, ref: string | null = null): CatalogEntry {
  return {
    id,
    name,
    ref,
    externalId: null,
    firstImageUrl: null,
    variantCount: 0,
  };
}

describe("filterCatalogEntries", () => {
  it("trouve une référence en fin de nom collée à un tiret (cas A405)", () => {
    const entries: CatalogEntry[] = [
      entryFor("p1", "Boucles d'oreilles en acier inoxydable - A405", "A405"),
      entryFor("p2", "Bague turquoise", "TURQ"),
      entryFor("p3", "Collier moderne A406", "A406"),
    ];
    const res = filterCatalogEntries(entries, "A405");
    expect(res.map((e) => e.id)).toEqual(["p1"]);
  });

  it("est insensible à la casse et aux accents", () => {
    const entries: CatalogEntry[] = [
      entryFor("p1", "Éloïse - REF1", "REF1"),
      entryFor("p2", "AUTRE", "OTHER"),
    ];
    expect(filterCatalogEntries(entries, "eloise").map((e) => e.id)).toEqual(["p1"]);
    expect(filterCatalogEntries(entries, "ELOÏSE").map((e) => e.id)).toEqual(["p1"]);
  });

  it("priorise référence exacte > référence préfixe > nom", () => {
    const entries: CatalogEntry[] = [
      entryFor("name-hit", "Modèle contenant A405 quelque part", "ZZZ"),
      entryFor("ref-prefix", "Une autre chose", "A405-bis"),
      entryFor("ref-exact", "X", "A405"),
    ];
    const res = filterCatalogEntries(entries, "A405");
    expect(res.map((e) => e.id)).toEqual(["ref-exact", "ref-prefix", "name-hit"]);
  });

  it("query vide → renvoie tout", () => {
    const entries: CatalogEntry[] = [entryFor("a", "A"), entryFor("b", "B")];
    expect(filterCatalogEntries(entries, "")).toEqual(entries);
  });
});

describe("loadFullCatalog + cache TTL", () => {
  beforeEach(() => {
    __resetCatalogCacheForTests();
    listAllMock.mockReset();
  });

  it("appelle onProgress à chaque page et écrit le résultat dans le cache", async () => {
    // Simule ankorstoreListAllProducts qui appelle onPage 3 fois et renvoie 5 produits.
    listAllMock.mockImplementation(async (opts: {
      onPage?: (page: unknown[], i: number, total: number) => void;
    }) => {
      opts.onPage?.([makeProduct({ id: "p1", name: "X1" })], 0, 2);
      opts.onPage?.([makeProduct({ id: "p2", name: "X2" })], 1, 4);
      opts.onPage?.([makeProduct({ id: "p3", name: "X3" })], 2, 5);
      return [
        makeProduct({ id: "p1", name: "X1", variantSkus: ["A405_RED"] }),
        makeProduct({ id: "p2", name: "X2" }),
        makeProduct({ id: "p3", name: "X3" }),
      ];
    });

    const progress: { loaded: number; pageIndex: number }[] = [];
    const entries = await loadFullCatalog((p) => progress.push(p));

    expect(entries).toHaveLength(3);
    expect(progress).toHaveLength(3);
    expect(progress[2]).toEqual({ loaded: 5, pageIndex: 2 });

    // Réf extraite depuis le SKU
    expect(entries.find((e) => e.id === "p1")?.ref).toBe("A405");

    // Cache frais → getCachedCatalog renvoie le même contenu
    const cached = getCachedCatalog();
    expect(cached).not.toBeNull();
    expect(cached?.length).toBe(3);
    expect(getCatalogStatus().fresh).toBe(true);
  });

  it("partage la promesse entre 2 appels concurrents (1 seul fetch Ankorstore)", async () => {
    listAllMock.mockImplementation(async () => {
      await new Promise((r) => setTimeout(r, 50));
      return [makeProduct({ id: "p1", name: "X" })];
    });

    const [a, b] = await Promise.all([loadFullCatalog(), loadFullCatalog()]);

    expect(listAllMock).toHaveBeenCalledTimes(1);
    expect(a).toEqual(b);
  });

  it("propage la progression du chargement en cours aux callers arrivant en retard", async () => {
    // Reproduit le cas : préchargement au boot déjà à 2 pages, puis la modale
    // s'ouvre. Le 2e caller doit recevoir la dernière progression + les pages
    // restantes, pas attendre en silence.
    let resolveLoad: (() => void) | null = null;
    let firePage: ((page: number, total: number) => void) | null = null;

    listAllMock.mockImplementation(async (opts: {
      onPage?: (page: unknown[], i: number, total: number) => void;
    }) => {
      firePage = (page, total) => opts.onPage?.([], page, total);
      // Page initiale envoyée avant l'arrivée du 2e caller
      opts.onPage?.([], 0, 50);
      await new Promise<void>((r) => {
        resolveLoad = r;
      });
      return [makeProduct({ id: "p1", name: "X" })];
    });

    const firstProgress: { loaded: number; pageIndex: number }[] = [];
    const firstPromise = loadFullCatalog((p) => firstProgress.push(p));

    // Laisse passer la 1re page côté 1er caller
    await new Promise((r) => setTimeout(r, 10));

    // 2e caller arrive en cours de route — il doit voir l'état actuel
    const lateProgress: { loaded: number; pageIndex: number }[] = [];
    const latePromise = loadFullCatalog((p) => lateProgress.push(p));

    // Replay immédiat de la dernière progression connue
    await new Promise((r) => setTimeout(r, 10));
    expect(lateProgress).toEqual([{ loaded: 50, pageIndex: 0 }]);

    // Une page supplémentaire arrive → les deux callers la reçoivent
    firePage?.(1, 100);
    await new Promise((r) => setTimeout(r, 10));
    expect(firstProgress).toContainEqual({ loaded: 100, pageIndex: 1 });
    expect(lateProgress).toContainEqual({ loaded: 100, pageIndex: 1 });

    resolveLoad?.();
    await Promise.all([firstPromise, latePromise]);
    expect(listAllMock).toHaveBeenCalledTimes(1);
  });

  it("invalidateCatalogCache vide le cache et permet un nouveau chargement", async () => {
    listAllMock.mockResolvedValue([makeProduct({ id: "p1", name: "X" })]);
    await loadFullCatalog();
    expect(getCachedCatalog()).not.toBeNull();

    invalidateCatalogCache();
    expect(getCachedCatalog()).toBeNull();
    expect(getCatalogStatus().fresh).toBe(false);

    // Un nouveau chargement repart de zéro
    listAllMock.mockResolvedValue([
      makeProduct({ id: "p2", name: "Y" }),
      makeProduct({ id: "p3", name: "Z" }),
    ]);
    const next = await loadFullCatalog();
    expect(next.map((e) => e.id)).toEqual(["p2", "p3"]);
  });

  it("propage l'erreur API sans laisser activeLoad coincé", async () => {
    listAllMock.mockRejectedValueOnce(new Error("boom"));
    await expect(loadFullCatalog()).rejects.toThrow("boom");

    // Après l'erreur, un nouvel appel doit retenter (pas bloqué par activeLoad)
    listAllMock.mockResolvedValueOnce([makeProduct({ id: "p1", name: "X" })]);
    const next = await loadFullCatalog();
    expect(next).toHaveLength(1);
  });

  it("partage le cache via globalThis (résiste aux ré-imports type bundles séparés)", async () => {
    // Reproduit le scénario Next.js : instrumentation et routes API sont
    // bundlées séparément. Sans `globalThis`, chaque bundle aurait sa propre
    // copie du module → mémoire jamais partagée. On vérifie ici que l'état
    // vit bien sur `globalThis` sous une clé Symbol.for stable.
    listAllMock.mockResolvedValue([makeProduct({ id: "p-shared", name: "Partagé" })]);
    await loadFullCatalog();

    const stateKey = Symbol.for("beliandjolie.ankorstoreCatalogCache");
    const g = globalThis as Record<symbol, unknown>;
    const sharedState = g[stateKey] as { cachedEntries: CatalogEntry[]; loadedAt: Date | null };

    expect(sharedState).toBeDefined();
    expect(sharedState.loadedAt).toBeInstanceOf(Date);
    expect(sharedState.cachedEntries).toHaveLength(1);
    expect(sharedState.cachedEntries[0].id).toBe("p-shared");

    // Simule un "second bundle" qui modifierait l'état partagé via la même
    // clé Symbol — l'API publique du module doit voir le changement.
    sharedState.cachedEntries = [
      ...sharedState.cachedEntries,
      { id: "injected", name: "Autre", ref: null, externalId: null, firstImageUrl: null, variantCount: 0 },
    ];
    const seen = getCachedCatalog();
    expect(seen?.map((e) => e.id)).toEqual(["p-shared", "injected"]);
  });
});
