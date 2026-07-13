import { describe, it, expect, vi, beforeEach } from "vitest";

// ─── State partagé ────────────────────────────────────────────────────────
const counts = new Map<string, number>();
let lastScope: object | null = null;

function setCount(k: string, n: number) { counts.set(k, n); }

// Le mock inspecte le `where` reçu et retourne un compteur défini par le test.
// La clé identifie la marketplace ciblée par la clause (ou "total" pour l'OR).
function categoryCount(where: any) {
  lastScope = where.tenantId ? { tenantId: where.tenantId } : {};
  if (where.OR) return counts.get("category:total") ?? 0;
  if (where.pfsCategoryId === null) return counts.get("category:pfs") ?? 0;
  if (where.efashionCategorieId === null) return counts.get("category:efashion") ?? 0;
  if (where.faireTaxonomyId === null) return counts.get("category:faire") ?? 0;
  return 0;
}
function colorCount(where: any) {
  if (where.OR) return counts.get("color:total") ?? 0;
  if (where.pfsColorRef === null) return counts.get("color:pfs") ?? 0;
  if (where.efashionColorId === null) return counts.get("color:efashion") ?? 0;
  return 0;
}
function compositionCount(where: any) {
  if (where.OR) return counts.get("composition:total") ?? 0;
  if (where.pfsCompositionRef === null) return counts.get("composition:pfs") ?? 0;
  if (where.efashionId === null) return counts.get("composition:efashion") ?? 0;
  if (where.faireMaterialLabel === null) return counts.get("composition:faire") ?? 0;
  return 0;
}
function seasonCount(where: any) {
  if (where.OR) return counts.get("season:total") ?? 0;
  if (where.pfsRef === null) return counts.get("season:pfs") ?? 0;
  if (where.efashionCollectionId === null) return counts.get("season:efashion") ?? 0;
  return 0;
}
function sizeCount(where: any) {
  if (where.OR) return counts.get("size:total") ?? 0;
  if (where.pfsSizeRef === null) return counts.get("size:pfs") ?? 0;
  return 0;
}
function countryCount(where: any) {
  if (where.OR) return counts.get("country:total") ?? 0;
  if (where.isoCode === null && where.pfsCountryRef === null) return counts.get("country:pfs") ?? 0;
  if (where.efashionProvenanceId === null) return counts.get("country:efashion") ?? 0;
  if (where.faireCountryCode === null) return counts.get("country:faire") ?? 0;
  return 0;
}
function hsCount(where: any) {
  if (where.faireFormat === null) return counts.get("hs:faire") ?? 0;
  return 0;
}

vi.mock("@/lib/prisma", () => ({
  prisma: {
    category: { count: vi.fn(async ({ where }: any) => categoryCount(where)) },
    color: { count: vi.fn(async ({ where }: any) => colorCount(where)) },
    composition: { count: vi.fn(async ({ where }: any) => compositionCount(where)) },
    season: { count: vi.fn(async ({ where }: any) => seasonCount(where)) },
    size: { count: vi.fn(async ({ where }: any) => sizeCount(where)) },
    manufacturingCountry: { count: vi.fn(async ({ where }: any) => countryCount(where)) },
    hsCode: { count: vi.fn(async ({ where }: any) => hsCount(where)) },
  },
}));

vi.mock("@/lib/cached-data", () => ({
  getCachedPfsCredentials: vi.fn(async () => ({ email: null, password: null })),
  getCachedEfashionEnabled: vi.fn(async () => false),
  getCachedFaireEnabled: vi.fn(async () => false),
}));

import { computeUnmappedAttributes, formatAttrLabel, loadMarketplaceFlags } from "@/lib/unmapped-attributes";

beforeEach(() => {
  counts.clear();
  lastScope = null;
});

describe("computeUnmappedAttributes — marketplaces désactivées", () => {
  it("retourne 0 partout si aucune marketplace n'est active", async () => {
    setCount("category:pfs", 99);
    setCount("category:efashion", 99);
    setCount("category:faire", 99);
    setCount("category:total", 99);

    const r = await computeUnmappedAttributes("t1", { pfs: false, efashion: false, faire: false });

    expect(r.categories.total).toBe(0);
    expect(r.categories.byMarketplace).toEqual({ pfs: 0, efashion: 0, faire: 0 });
    expect(r.categories.reasons).toEqual([]);
    expect(r.totalUnmapped).toBe(0);
  });

  it("n'interroge PFS que si PFS est actif", async () => {
    setCount("category:efashion", 5);
    setCount("category:total", 5);

    const r = await computeUnmappedAttributes("t1", { pfs: false, efashion: true, faire: false });

    expect(r.categories.byMarketplace.pfs).toBe(0);
    expect(r.categories.byMarketplace.efashion).toBe(5);
    expect(r.categories.reasons).toEqual(["5 sans lien eFashion"]);
  });
});

describe("computeUnmappedAttributes — comptage par attribut", () => {
  it("catégories : cumule PFS + eFashion + Faire dans reasons", async () => {
    setCount("category:pfs", 2);
    setCount("category:efashion", 3);
    setCount("category:faire", 1);
    setCount("category:total", 4);

    const r = await computeUnmappedAttributes("t1", { pfs: true, efashion: true, faire: true });

    expect(r.categories.total).toBe(4);
    expect(r.categories.byMarketplace).toEqual({ pfs: 2, efashion: 3, faire: 1 });
    expect(r.categories.reasons).toEqual([
      "2 sans lien PFS",
      "3 sans lien eFashion",
      "1 sans lien Faire",
    ]);
  });

  it("codes SH : compte uniquement Faire", async () => {
    setCount("hs:faire", 8);

    const r = await computeUnmappedAttributes("t1", { pfs: true, efashion: true, faire: true });

    expect(r.shCodes.total).toBe(8);
    expect(r.shCodes.byMarketplace).toEqual({ faire: 8 });
    expect(r.shCodes.reasons).toEqual(["8 sans lien Faire"]);
  });

  it("pays d'origine : compte isoCode ET pfsCountryRef manquants pour PFS", async () => {
    setCount("country:pfs", 5);
    setCount("country:total", 5);

    const r = await computeUnmappedAttributes("t1", { pfs: true, efashion: false, faire: false });

    expect(r.countries.byMarketplace.pfs).toBe(5);
    expect(r.countries.total).toBe(5);
  });

  it("cumul total sur totalUnmapped", async () => {
    setCount("category:total", 3);
    setCount("color:total", 12);
    setCount("season:total", 1);
    setCount("country:total", 5);
    setCount("hs:faire", 8);

    const r = await computeUnmappedAttributes("t1", { pfs: true, efashion: true, faire: true });

    expect(r.totalUnmapped).toBe(3 + 12 + 1 + 5 + 8);
  });
});

describe("computeUnmappedAttributes — scope tenant", () => {
  it("passe tenantId dans le where quand tid != 'global'", async () => {
    setCount("category:pfs", 1);
    await computeUnmappedAttributes("tenant-abc", { pfs: true, efashion: false, faire: false });
    expect(lastScope).toEqual({ tenantId: "tenant-abc" });
  });

  it("ne passe pas tenantId quand tid === 'global'", async () => {
    setCount("category:pfs", 1);
    await computeUnmappedAttributes("global", { pfs: true, efashion: false, faire: false });
    expect(lastScope).toEqual({});
  });
});

describe("formatAttrLabel — pluralisation FR", () => {
  it("singulier pour n <= 1", () => {
    expect(formatAttrLabel("categories", 1)).toBe("1 catégorie sans mapping");
    expect(formatAttrLabel("colors", 1)).toBe("1 couleur sans mapping");
    expect(formatAttrLabel("shCodes", 1)).toBe("1 code SH sans format Faire");
  });

  it("pluriel pour n > 1", () => {
    expect(formatAttrLabel("categories", 3)).toBe("3 catégories sans mapping");
    expect(formatAttrLabel("compositions", 5)).toBe("5 compositions sans mapping");
    expect(formatAttrLabel("countries", 2)).toBe("2 pays sans mapping");
  });
});

describe("loadMarketplaceFlags", () => {
  it("PFS actif si email + password présents", async () => {
    const cached = await import("@/lib/cached-data");
    (cached.getCachedPfsCredentials as any).mockResolvedValueOnce({ email: "a@b.co", password: "x" });
    const flags = await loadMarketplaceFlags();
    expect(flags.pfs).toBe(true);
  });

  it("PFS inactif si un des deux manque", async () => {
    const cached = await import("@/lib/cached-data");
    (cached.getCachedPfsCredentials as any).mockResolvedValueOnce({ email: "a@b.co", password: null });
    const flags = await loadMarketplaceFlags();
    expect(flags.pfs).toBe(false);
  });
});
