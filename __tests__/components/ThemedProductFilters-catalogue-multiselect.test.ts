import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

// 2026-09-29 — Le panneau Catalogue passe en multi-sélection : les 5 filtres
// (Catégorie, Sous-catégorie, Composition, Mot-clé, Code SH) utilisent le
// composant `MultiSelect` avec cases à cocher. L'URL sérialise les valeurs
// choisies en virgule (« id1,id2,__none__ »).

const THEMED = readFileSync(
  resolve(__dirname, "../../components/admin/products/ThemedProductFilters.tsx"),
  "utf8",
);

describe("ThemedProductFilters — panneau Catalogue en multi-sélection", () => {
  it("importe le composant MultiSelect", () => {
    expect(THEMED).toContain("import MultiSelect from \"@/components/ui/MultiSelect\"");
  });

  it("expose 5 MultiSelect (un par filtre Catalogue)", () => {
    const matches = THEMED.match(/<MultiSelect\b/g);
    expect(matches?.length).toBeGreaterThanOrEqual(5);
  });

  it("chaque filtre écrit une chaîne CSV vers l'URL (ou null quand vide)", () => {
    // `writeMulti` factorise la sérialisation join(",") + null → suppression
    // de la clé URL.
    expect(THEMED).toContain("writeMulti");
    expect(THEMED).toContain(`next.join(",")`);
  });

  it("chaque filtre lit une chaîne CSV depuis l'URL et la découpe", () => {
    expect(THEMED).toContain("parseMulti");
    expect(THEMED).toContain('.split(",")');
  });

  it("purge automatiquement les sous-cats orphelines quand on décoche leur catégorie mère", () => {
    // Sans ça, désélectionner une catégorie laisserait ses sous-cats cochées
    // dans le filtre — comportement déroutant côté cliente.
    expect(THEMED).toContain("keptSubCats");
  });
});
