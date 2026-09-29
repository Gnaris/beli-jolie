import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

// 2026-09-29 — Le filtre Sous-catégorie du panneau Catalogue doit rester
// utilisable même sans catégorie sélectionnée. Avant, la liste était grisée
// et seule « Sans sous-catégorie » restait cliquable (déroutant côté cliente).
// Correction : quand `cat` est vide, on liste toutes les sous-catégories
// préfixées par leur catégorie mère (« Bague › Chevalière »…), et le champ
// n'est plus disabled.

const THEMED = readFileSync(
  resolve(__dirname, "../../components/admin/products/ThemedProductFilters.tsx"),
  "utf8",
);

describe("ThemedProductFilters — sous-catégorie sans catégorie parente", () => {
  it("liste toutes les sous-catégories préfixées par leur catégorie quand `cat` est vide", () => {
    expect(THEMED).toContain("categories.flatMap");
    expect(THEMED).toContain("`${c.name} › ${s.name}`");
  });

  it("ne grise plus le CustomSelect Sous-catégorie quand aucune catégorie n'est choisie", () => {
    expect(THEMED).not.toContain('disabled={!cat && subCat !== "__none__"}');
  });

  it("supprime le message « Choisissez d'abord une catégorie »", () => {
    expect(THEMED).not.toContain("Choisissez d'abord une catégorie");
  });
});
