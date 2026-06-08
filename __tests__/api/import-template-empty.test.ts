import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

// Le modèle Excel livré pour l'import en masse ne doit plus contenir de
// produits pré-remplis : la cliente veut un fichier vierge à remplir.
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

describe("Modèle Excel d'import — pas de produits-exemple pré-remplis", () => {
  it("aucune référence des anciens exemples ne subsiste", () => {
    expect(SRC).not.toContain("TSH-001");
    expect(SRC).not.toContain("TSH-002");
    expect(SRC).not.toContain("MOC-001");
  });

  it("aucun nom de produit-exemple ne subsiste", () => {
    expect(SRC).not.toContain("T-shirt Essentiel");
    expect(SRC).not.toContain("T-shirt Oversize Urban");
    expect(SRC).not.toContain("Mocassin Cambridge");
  });

  it("la boucle d'écriture des données-exemple a été retirée", () => {
    expect(SRC).not.toContain("SAMPLE_DATA");
    expect(SRC).not.toContain("getProductGroupIndex");
  });

  it("les lignes d'en-tête (sections, headers, statut obligatoire, ex) sont conservées", () => {
    expect(SRC).toContain("Fiche produit");
    expect(SRC).toContain("Variante");
    expect(SRC).toContain("Obligatoire");
    expect(SRC).toContain("Facultatif");
    expect(SRC).toContain("(ex : ");
  });
});
