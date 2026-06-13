import { describe, it, expect } from "vitest";
import {
  searchFaireTaxonomy,
  findFaireTaxonomyById,
  type FaireTaxonomyType,
} from "@/lib/faire-taxonomy";

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
