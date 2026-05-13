import { describe, it, expect } from "vitest";
import {
  scoreAnkorstoreSearchResult,
  sortAnkorstoreSearchResults,
} from "@/lib/ankorstore-search-rank";
import type { AnkorstoreProduct } from "@/lib/ankorstore-api";

function makeProduct(overrides: Partial<AnkorstoreProduct> & {
  variantSkus?: (string | null)[];
}): AnkorstoreProduct {
  const variants = (overrides.variantSkus ?? []).map((sku, i) => ({
    id: `v${i + 1}`,
    sku,
    stockQuantity: 1,
    isAlwaysInStock: false,
    wholesalePrice: 10,
    retailPrice: 20,
    options: [],
  }));
  return {
    id: overrides.id ?? "p1",
    externalId: overrides.externalId ?? null,
    name: overrides.name ?? "Produit test",
    description: overrides.description ?? "",
    currency: "EUR",
    vatRate: 20,
    unitMultiplier: 1,
    wholesalePrice: 10,
    retailPrice: 20,
    countryCode: "FR",
    images: [],
    variants,
    ...overrides,
  } as AnkorstoreProduct;
}

describe("scoreAnkorstoreSearchResult", () => {
  it("référence extraite identique (depuis le SKU) → score max 100", () => {
    const p = makeProduct({ variantSkus: ["A405_C1_UNIT_1"] });
    expect(scoreAnkorstoreSearchResult(p, "A405")).toBe(100);
  });

  it("SKU exact = query → 90", () => {
    const p = makeProduct({ variantSkus: ["a405"], name: "Sans rapport" });
    expect(scoreAnkorstoreSearchResult(p, "a405")).toBe(100); // extractReference returns "a405" too
  });

  it("SKU commence par '{query}_' (notre convention) → 80 si pas déjà 100", () => {
    // Un produit dont la 1ère variante a un SKU "XYZ_..." (donc extractRef = "XYZ")
    // mais une autre variante a "A405_..." — query "A405" doit scorer ≥ 80.
    const p = makeProduct({
      variantSkus: ["XYZ_unit", "A405_C1_UNIT_1"],
    });
    expect(scoreAnkorstoreSearchResult(p, "A405")).toBeGreaterThanOrEqual(80);
  });

  it("nom commence par la query → au moins 40", () => {
    const p = makeProduct({
      name: "A405 Bague tendance",
      variantSkus: ["unrelated_sku"],
    });
    expect(scoreAnkorstoreSearchResult(p, "A405")).toBeGreaterThanOrEqual(40);
  });

  it("nom contient seulement la query au milieu → 30", () => {
    const p = makeProduct({
      name: "Collection A405 spéciale",
      variantSkus: ["xy_unit_1"],
    });
    expect(scoreAnkorstoreSearchResult(p, "A405")).toBe(30);
  });

  it("aucun lien clair → score faible (10)", () => {
    const p = makeProduct({
      name: "Bague turquoise",
      variantSkus: ["TURQ_UNIT_1"],
    });
    expect(scoreAnkorstoreSearchResult(p, "A405")).toBe(10);
  });

  it("insensible à la casse", () => {
    const p = makeProduct({ variantSkus: ["a405_c1_unit_1"] });
    expect(scoreAnkorstoreSearchResult(p, "A405")).toBe(100);
  });
});

describe("sortAnkorstoreSearchResults", () => {
  it("remonte la référence exacte en tête même si elle est en bas de la liste reçue", () => {
    const noise = Array.from({ length: 10 }).map((_, i) =>
      makeProduct({
        id: `noise${i}`,
        name: `Produit divers A40 numéro ${i}`,
        variantSkus: [`other_${i}`],
      }),
    );
    const target = makeProduct({
      id: "target",
      variantSkus: ["A405_C1_UNIT_1"],
    });
    // La cible est positionnée 11e dans la liste reçue
    const products = [...noise, target];
    const sorted = sortAnkorstoreSearchResults(products, "A405");
    expect(sorted[0].id).toBe("target");
  });

  it("préserve l'ordre relatif des candidats de même score (tri stable)", () => {
    const a = makeProduct({ id: "a", name: "Aurore A405 modèle" });
    const b = makeProduct({ id: "b", name: "Bracelet A405 modèle" });
    const sorted = sortAnkorstoreSearchResults([a, b], "A405");
    // Mêmes scores (30 chacun, "contient") → ordre d'origine préservé
    expect(sorted.map((p) => p.id)).toEqual(["a", "b"]);
  });

  it("trie un mix variétal correctement", () => {
    const exact = makeProduct({ id: "exact", variantSkus: ["A405_unit"] });
    const nameStart = makeProduct({ id: "start", name: "A405 bracelet" });
    const nameMid = makeProduct({ id: "mid", name: "Modèle A405" });
    const unrelated = makeProduct({ id: "noise", name: "Autre chose" });
    const sorted = sortAnkorstoreSearchResults(
      [unrelated, nameMid, nameStart, exact],
      "A405",
    );
    expect(sorted.map((p) => p.id)).toEqual(["exact", "start", "mid", "noise"]);
  });
});
