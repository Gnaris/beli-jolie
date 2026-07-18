import { describe, it, expect, vi, beforeEach } from "vitest";

const hasFaireConfigMock = vi.fn();
const faireFetchMock = vi.fn();

vi.mock("@/lib/cached-data", () => ({
  getCachedHasFaireConfig: (...a: unknown[]) => hasFaireConfigMock(...a),
  // Sous test on court-circuite le wrapper cache : on appelle directement
  // le callback pour vérifier le comportement de `loadFreshTaxonomy`.
  tenantScopedCacheWithTid: (
    _keyBase: string,
    fn: (tid: string) => Promise<unknown>,
  ) => () => fn("test-tenant"),
}));

vi.mock("@/lib/faire-api", () => ({
  faireFetch: (...a: unknown[]) => faireFetchMock(...a),
}));

import {
  searchFaireTaxonomy,
  findFaireTaxonomyById,
  type FaireTaxonomyType,
} from "@/lib/faire-taxonomy";
import { loadFreshTaxonomy, getFaireTaxonomy } from "@/lib/faire-taxonomy";

const sample: FaireTaxonomyType[] = [
  { id: "tt_aaa111aaaa", name: "Bracelet", cleanName: "Bracelets" },
  { id: "tt_bbb222bbbb", name: "Bracelets", cleanName: "Bracelets" },
  { id: "tt_ccc333cccc", name: "Collier", cleanName: "Colliers" },
  {
    id: "tt_ddd444dddd",
    name: "Bracelet jonc",
    cleanName: "Bracelets",
    categoryBreadcrumb: ["Bijoux", "Bracelets"],
  },
  { id: "tt_eee555eeee", name: "Boucles d'oreilles", cleanName: "Boucles" },
];

describe("searchFaireTaxonomy", () => {
  it("priorise les matches exacts", () => {
    const r = searchFaireTaxonomy(sample, "bracelet", 5);
    expect(r[0].name.toLowerCase()).toBe("bracelet");
  });

  it("trouve les préfixes après les exacts", () => {
    const r = searchFaireTaxonomy(sample, "bracelet", 5);
    const names = r.map((t) => t.name);
    expect(names).toContain("Bracelet");
    expect(names).toContain("Bracelets");
    expect(names).toContain("Bracelet jonc");
  });

  it("ignore les accents et la casse", () => {
    const r = searchFaireTaxonomy(sample, "BOUCLES D'OREILLES", 5);
    expect(r.length).toBeGreaterThan(0);
    expect(r[0].name).toBe("Boucles d'oreilles");
  });

  it("retourne la liste limitée quand la query est vide", () => {
    const r = searchFaireTaxonomy(sample, "", 2);
    expect(r).toHaveLength(2);
  });

  it("limite le nombre de résultats", () => {
    const r = searchFaireTaxonomy(sample, "bracelet", 2);
    expect(r).toHaveLength(2);
  });

  it("retourne [] quand aucun match", () => {
    const r = searchFaireTaxonomy(sample, "pizza", 5);
    expect(r).toEqual([]);
  });
});

describe("findFaireTaxonomyById", () => {
  it("trouve par id exact", () => {
    expect(findFaireTaxonomyById(sample, "tt_aaa111aaaa")?.name).toBe("Bracelet");
  });

  it("retourne null si non trouvé", () => {
    expect(findFaireTaxonomyById(sample, "tt_zzz")).toBeNull();
  });
});

// ─── Fetch réseau : `loadFreshTaxonomy` doit throw sur toute condition qui
// donnerait un résultat vide, sinon `unstable_cache` mémoriserait 24h de []
// et empoisonnerait l'UI de tous les tenants (cf. incident 2026-07-18).
describe("loadFreshTaxonomy", () => {
  beforeEach(() => {
    hasFaireConfigMock.mockReset();
    faireFetchMock.mockReset();
  });

  it("throw quand le tenant n'a pas de clé Faire configurée", async () => {
    hasFaireConfigMock.mockResolvedValue(false);
    await expect(loadFreshTaxonomy()).rejects.toThrow(/no API key/);
    expect(faireFetchMock).not.toHaveBeenCalled();
  });

  it("throw quand /products/types renvoie HTTP !ok", async () => {
    hasFaireConfigMock.mockResolvedValue(true);
    faireFetchMock.mockResolvedValue({ ok: false, status: 502 });
    await expect(loadFreshTaxonomy()).rejects.toThrow(/HTTP 502/);
  });

  it("throw quand la réponse est valide mais vide", async () => {
    hasFaireConfigMock.mockResolvedValue(true);
    faireFetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({ taxonomy_types: [] }),
    });
    await expect(loadFreshTaxonomy()).rejects.toThrow(/empty response/);
  });

  it("throw si toutes les entrées sont non-normalisables (id ou name manquant)", async () => {
    hasFaireConfigMock.mockResolvedValue(true);
    faireFetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({ taxonomy_types: [{ id: "tt_x" }, { name: "orphan" }] }),
    });
    await expect(loadFreshTaxonomy()).rejects.toThrow(/empty response/);
  });

  it("retourne la taxonomie normalisée quand la réponse est valide", async () => {
    hasFaireConfigMock.mockResolvedValue(true);
    faireFetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({
        taxonomy_types: [
          {
            id: "tt_aaa",
            name: "Bracelet",
            clean_name: "Bracelets",
            category_breadcrumbs: [{ categories: ["Bijoux", "Bracelets"] }],
          },
        ],
      }),
    });
    const rows = await loadFreshTaxonomy();
    expect(rows).toEqual([
      {
        id: "tt_aaa",
        name: "Bracelet",
        cleanName: "Bracelets",
        categoryBreadcrumb: ["Bijoux", "Bracelets"],
        targetCustomer: undefined,
      },
    ]);
  });

  it("accepte aussi la forme `types` (fallback si le champ `taxonomy_types` manque)", async () => {
    hasFaireConfigMock.mockResolvedValue(true);
    faireFetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({
        types: [{ token: "tt_zzz", clean_name: "Colliers" }],
      }),
    });
    const rows = await loadFreshTaxonomy();
    expect(rows).toHaveLength(1);
    expect(rows[0].id).toBe("tt_zzz");
    expect(rows[0].name).toBe("Colliers");
  });
});

describe("getFaireTaxonomy (wrapper cache)", () => {
  beforeEach(() => {
    hasFaireConfigMock.mockReset();
    faireFetchMock.mockReset();
  });

  it("catche l'erreur du fetch et retourne [] (mais unstable_cache ne mémorise pas le throw sous-jacent)", async () => {
    hasFaireConfigMock.mockResolvedValue(false);
    const rows = await getFaireTaxonomy();
    expect(rows).toEqual([]);
  });
});
