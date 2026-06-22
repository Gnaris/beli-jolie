import { describe, it, expect } from "vitest";
import { findDuplicateVariantKeys } from "@/lib/import-processor";

/**
 * Verrou anti-doublons : si l'Excel d'import contient deux lignes avec la même
 * (couleur, type de vente) pour la même référence (typiquement un bloc collé
 * deux fois), l'import doit refuser le produit au lieu de créer des
 * ProductColors fantômes qui font ensuite échouer la création des
 * VariantSize sur la contrainte d'unicité.
 */
describe("findDuplicateVariantKeys", () => {
  it("ne signale aucun doublon sur des variantes distinctes", () => {
    const dupes = findDuplicateVariantKeys([
      { color: "Doré", saleType: "UNIT" },
      { color: "Argent", saleType: "UNIT" },
      { color: "Doré", saleType: "PACK" },
      { color: "Argent", saleType: "PACK" },
    ]);
    expect(dupes).toEqual([]);
  });

  it("détecte un doublon strict (couleur + saleType identiques)", () => {
    const dupes = findDuplicateVariantKeys([
      { color: "Doré", saleType: "UNIT" },
      { color: "Doré", saleType: "UNIT" },
    ]);
    expect(dupes).toEqual(["Doré / UNIT"]);
  });

  it("détecte le cas client A2557E : bloc de 4 variantes collé deux fois", () => {
    const block = [
      { color: "Doré", saleType: "UNIT" as const },
      { color: "Argent", saleType: "UNIT" as const },
      { color: "Doré", saleType: "PACK" as const },
      { color: "Argent", saleType: "PACK" as const },
    ];
    const dupes = findDuplicateVariantKeys([...block, ...block]);
    expect(dupes.sort()).toEqual([
      "Argent / PACK",
      "Argent / UNIT",
      "Doré / PACK",
      "Doré / UNIT",
    ]);
  });

  it("ignore les accents et la casse pour comparer les couleurs", () => {
    const dupes = findDuplicateVariantKeys([
      { color: "Doré", saleType: "UNIT" },
      { color: "DORE", saleType: "UNIT" },
    ]);
    expect(dupes).toHaveLength(1);
  });

  it("différencie UNIT et PACK d'une même couleur", () => {
    const dupes = findDuplicateVariantKeys([
      { color: "Doré", saleType: "UNIT" },
      { color: "Doré", saleType: "PACK" },
    ]);
    expect(dupes).toEqual([]);
  });

  it("ignore les lignes sans couleur (déjà signalées par ailleurs)", () => {
    const dupes = findDuplicateVariantKeys([
      { color: "", saleType: "UNIT" },
      { color: "", saleType: "UNIT" },
    ]);
    expect(dupes).toEqual([]);
  });

  it("ne liste chaque combinaison qu'une seule fois même si elle apparaît 3+ fois", () => {
    const dupes = findDuplicateVariantKeys([
      { color: "Doré", saleType: "UNIT" },
      { color: "Doré", saleType: "UNIT" },
      { color: "Doré", saleType: "UNIT" },
    ]);
    expect(dupes).toEqual(["Doré / UNIT"]);
  });
});
