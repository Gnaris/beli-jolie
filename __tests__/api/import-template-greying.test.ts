import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

// Le modèle Excel d'import doit grisée automatiquement les cellules de la
// section "Fiche produit" sur les lignes de variantes secondaires (référence
// vide + couleur remplie). Ainsi la cliente voit d'un coup d'œil que les
// infos produit n'ont pas à être répétées.
//
// On vérifie au niveau du source pour rester rapide et indépendant d'ExcelJS
// (la génération réelle nécessite un session admin).
const SRC = readFileSync(
  resolve(
    __dirname,
    "../../app/api/admin/products/import/template/route.ts",
  ),
  "utf8",
);

describe("Modèle Excel d'import — grisage conditionnel des lignes de variantes secondaires", () => {
  it("ajoute une règle de mise en forme conditionnelle (addConditionalFormatting)", () => {
    expect(SRC).toContain("addConditionalFormatting");
  });

  it("utilise une formule combinant ISBLANK référence ET NOT(ISBLANK) couleur", () => {
    expect(SRC).toMatch(/ISBLANK\(\$\$\{refColLetter\}/);
    expect(SRC).toMatch(/NOT\(ISBLANK\(\$\$\{colorColLetter\}/);
  });

  it("applique la règle uniquement à la section Fiche produit (pas la section Variante)", () => {
    // La plage commence à la 1re colonne et s'arrête juste avant la section Variante
    expect(SRC).toMatch(/colLetter\(0\)\}\$\{dataStartRow\}:\$\{colLetter\(PRODUCT_COL_COUNT - 1\)\}/);
  });

  it("définit les couleurs grisées dans la palette (inheritedBg, inheritedText)", () => {
    expect(SRC).toContain("inheritedBg");
    expect(SRC).toContain("inheritedText");
    expect(SRC).toContain("E5E7EB"); // gray-200 — fond gris doux
    expect(SRC).toContain("9CA3AF"); // gray-400 — texte gris doux
  });

  it("ne grisée pas les lignes complètement vides (couleur doit être remplie)", () => {
    // La règle exige NOT(ISBLANK) sur la colonne couleur — donc une ligne
    // entièrement vide reste blanche dans le modèle livré.
    expect(SRC).toMatch(/NOT\(ISBLANK/);
  });
});
