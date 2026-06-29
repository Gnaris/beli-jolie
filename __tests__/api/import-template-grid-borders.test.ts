import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

// Le modèle Excel doit afficher une grille sur les cellules de données
// (lignes 5+). Sans bordure explicite, le fond blanc plein appliqué aux
// cellules masque les quadrillages natifs d'Excel — la cliente s'est
// plainte de ne plus voir la grille.
const SRC = readFileSync(
  resolve(
    __dirname,
    "../../app/api/admin/products/import/template/route.ts",
  ),
  "utf8",
);

describe("Modèle Excel d'import — grille visible sur les cellules de données", () => {
  it("applique BORDER_THIN sur chaque cellule de la zone de saisie (lignes 5+)", () => {
    // On localise la boucle de style des cellules de données (la seule qui
    // itère sur les colonnes via `c <= COLUMNS.length`) et on vérifie qu'elle
    // pose bien une bordure (sinon la grille disparaît).
    const dataLoop = SRC.match(
      /for \(let c = 1; c <= COLUMNS\.length; c\+\+\) \{[\s\S]*?\n {6}\}/,
    );
    expect(dataLoop, "boucle de style des cellules de données introuvable").not.toBeNull();
    expect(dataLoop![0]).toContain("cell.border = BORDER_THIN");
  });

  it("utilise une couleur de grille gris légèrement foncé (slate-300)", () => {
    // Slate-300 (CBD5E1) — assez visible sans être agressif.
    expect(SRC).toMatch(/border:\s*"CBD5E1"/);
  });
});
