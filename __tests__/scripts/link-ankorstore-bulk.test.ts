import { describe, expect, it } from "vitest";
import type {
  AnkorstoreProduct,
  AnkorstoreVariant,
} from "@/lib/ankorstore-api";
import type { MatchResult, VariantMatchPair } from "@/lib/ankorstore-match";
import {
  buildMatchedRows,
  parseMode,
  pickRowsForUnSeul,
  splitAmbiguousAkSide,
  splitStrictRows,
  type MatchedRow,
} from "@/scripts/link-ankorstore-bulk";
import type { BjProductForMatch } from "@/lib/ankorstore-match";

// ─── Helpers de fixtures ──────────────────────────────────────────────

function makeVariant(id: string, sku: string): AnkorstoreVariant {
  return {
    id,
    sku,
    ian: null,
    name: id,
    retailPrice: 0,
    wholesalePrice: 0,
    availableQuantity: 0,
    stockQuantity: 0,
    isAlwaysInStock: false,
  };
}

function makeAnkorstoreProduct(
  id: string,
  name: string,
  variants: AnkorstoreVariant[],
): AnkorstoreProduct {
  return {
    id,
    externalId: null,
    name,
    description: "",
    retailPrice: 0,
    wholesalePrice: 0,
    vatRate: 0,
    active: true,
    archived: false,
    images: [],
    variants,
  };
}

function makeVariantMatch(
  variant: AnkorstoreVariant,
  bjColorId: string | null,
  confidence: "exact" | "fuzzy" | "none" = bjColorId ? "exact" : "none",
): VariantMatchPair {
  return {
    ankorstoreVariant: variant,
    bjColorId,
    bjColorName: bjColorId ? "Couleur" : null,
    confidence,
  };
}

function bj(id: string, ref: string, unitColorIds: string[]): BjProductForMatch {
  return {
    id,
    name: `BJ ${id}`,
    reference: ref,
    colors: unitColorIds.map((c) => ({ id: c, name: c })),
  };
}

function makeMatchedResult(
  ref: string,
  bjId: string,
  bjName: string,
  akName: string,
  variants: AnkorstoreVariant[],
  variantPairs: { variant: AnkorstoreVariant; bjColorId: string | null }[],
): MatchResult {
  return {
    ankorstoreProduct: makeAnkorstoreProduct(`ak_${ref}`, akName, variants),
    status: "matched",
    extractedRef: ref,
    bjProductIds: [bjId],
    bjProductNames: [bjName],
    variantMatches: variantPairs.map((vp) =>
      makeVariantMatch(vp.variant, vp.bjColorId),
    ),
  };
}

// ─── parseMode ─────────────────────────────────────────────────────────

describe("parseMode", () => {
  it("accepte simulation/un-seul/tout", () => {
    expect(parseMode("simulation")).toBe("simulation");
    expect(parseMode("un-seul")).toBe("un-seul");
    expect(parseMode("tout")).toBe("tout");
  });

  it("retourne null pour un mode inconnu ou absent", () => {
    expect(parseMode(undefined)).toBeNull();
    expect(parseMode("")).toBeNull();
    expect(parseMode("publish")).toBeNull();
    expect(parseMode("Simulation")).toBeNull(); // case-sensitive
  });
});

// ─── buildMatchedRows ──────────────────────────────────────────────────

describe("buildMatchedRows", () => {
  it("ne garde que les statuts 'matched'", () => {
    const v = makeVariant("v1", "RBA1_NOIR");
    const matched = makeMatchedResult("RBA1", "bj1", "Robe", "Robe AS", [v], [
      { variant: v, bjColorId: "color_noir" },
    ]);
    const ambiguous: MatchResult = {
      ankorstoreProduct: makeAnkorstoreProduct("ak_amb", "Ambigu", []),
      status: "ambiguous",
      extractedRef: "RBA2",
      bjProductIds: ["bj2", "bj3"],
      bjProductNames: ["Robe 2", "Robe 3"],
      variantMatches: [],
    };
    const unmatched: MatchResult = {
      ankorstoreProduct: makeAnkorstoreProduct("ak_unm", "Inconnu", []),
      status: "unmatched",
      extractedRef: null,
      bjProductIds: [],
      bjProductNames: [],
      variantMatches: [],
    };

    const rows = buildMatchedRows(
      [matched, ambiguous, unmatched],
      [bj("bj1", "RBA1", ["color_noir"])],
    );

    expect(rows).toHaveLength(1);
    expect(rows[0].bjReference).toBe("RBA1");
    expect(rows[0].akName).toBe("Robe AS");
    expect(rows[0].bjUnitColorCount).toBe(1);
    expect(rows[0].hasFuzzyMatch).toBe(false);
  });

  it("extrait les paires de variantes en ignorant les bjColorId null", () => {
    const v1 = makeVariant("v1", "RBA1_NOIR");
    const v2 = makeVariant("v2", "RBA1_INCONNU"); // pas de couleur locale
    const v3 = makeVariant("v3", "RBA1_BLEU");
    const result = makeMatchedResult("RBA1", "bj1", "Robe", "Robe AS", [v1, v2, v3], [
      { variant: v1, bjColorId: "color_noir" },
      { variant: v2, bjColorId: null },
      { variant: v3, bjColorId: "color_bleu" },
    ]);

    const rows = buildMatchedRows(
      [result],
      [bj("bj1", "RBA1", ["color_noir", "color_bleu"])],
    );

    expect(rows[0].variantPairs).toEqual([
      { localColorId: "color_noir", ankorstoreVariantId: "v1" },
      { localColorId: "color_bleu", ankorstoreVariantId: "v3" },
    ]);
    expect(rows[0].totalAkVariants).toBe(3);
    expect(rows[0].bjUnitColorCount).toBe(2);
  });

  it("retourne extractedRef='?' quand la reference est null", () => {
    const result: MatchResult = {
      ankorstoreProduct: makeAnkorstoreProduct("ak_x", "X", []),
      status: "matched",
      extractedRef: null,
      bjProductIds: ["bj_x"],
      bjProductNames: ["X local"],
      variantMatches: [],
    };

    const rows = buildMatchedRows([result], [bj("bj_x", "?", ["c1"])]);

    expect(rows[0].bjReference).toBe("?");
    expect(rows[0].extractedRef).toBe("?");
  });

  it("detecte hasFuzzyMatch quand au moins une variante est fuzzy", () => {
    const v1 = makeVariant("v1", "RBA1_NOIR");
    const v2 = makeVariant("v2", "RBA1_BLEU");
    const result: MatchResult = {
      ankorstoreProduct: makeAnkorstoreProduct("ak1", "Robe AS", [v1, v2]),
      status: "matched",
      extractedRef: "RBA1",
      bjProductIds: ["bj1"],
      bjProductNames: ["Robe"],
      variantMatches: [
        makeVariantMatch(v1, "color_noir", "exact"),
        makeVariantMatch(v2, "color_bleu", "fuzzy"),
      ],
    };
    const rows = buildMatchedRows([result], [bj("bj1", "RBA1", ["color_noir", "color_bleu"])]);
    expect(rows[0].hasFuzzyMatch).toBe(true);
  });
});

// ─── splitStrictRows ───────────────────────────────────────────────────

describe("splitStrictRows", () => {
  function row(opts: Partial<MatchedRow> & { variantPairs?: { localColorId: string; ankorstoreVariantId: string }[] }): MatchedRow {
    return {
      bjId: "bj1",
      bjName: "Robe",
      bjReference: "RBA1",
      akId: "ak1",
      akName: "Robe AS",
      extractedRef: "RBA1",
      variantPairs: [],
      totalAkVariants: 0,
      bjUnitColorCount: 0,
      hasFuzzyMatch: false,
      ...opts,
    };
  }

  it("garde safe quand AS=BJ=appariees, pas de fuzzy, pas de doublon", () => {
    const r = row({
      variantPairs: [
        { localColorId: "c1", ankorstoreVariantId: "v1" },
        { localColorId: "c2", ankorstoreVariantId: "v2" },
      ],
      totalAkVariants: 2,
      bjUnitColorCount: 2,
    });
    const { safe, rejected } = splitStrictRows([r]);
    expect(safe).toHaveLength(1);
    expect(rejected).toHaveLength(0);
  });

  it("rejette si AS a une variante en plus", () => {
    const r = row({
      variantPairs: [{ localColorId: "c1", ankorstoreVariantId: "v1" }],
      totalAkVariants: 2,
      bjUnitColorCount: 1,
    });
    const { safe, rejected } = splitStrictRows([r]);
    expect(safe).toHaveLength(0);
    expect(rejected).toHaveLength(1);
    expect(rejected[0].reasons.join(" ")).toMatch(/Ankorstore sans equivalent/);
  });

  it("rejette si BJ a une variante en plus", () => {
    const r = row({
      variantPairs: [{ localColorId: "c1", ankorstoreVariantId: "v1" }],
      totalAkVariants: 1,
      bjUnitColorCount: 2,
    });
    const { rejected } = splitStrictRows([r]);
    expect(rejected[0].reasons.join(" ")).toMatch(/chez vous sans equivalent/);
  });

  it("rejette si fuzzy match", () => {
    const r = row({
      variantPairs: [
        { localColorId: "c1", ankorstoreVariantId: "v1" },
        { localColorId: "c2", ankorstoreVariantId: "v2" },
      ],
      totalAkVariants: 2,
      bjUnitColorCount: 2,
      hasFuzzyMatch: true,
    });
    const { rejected } = splitStrictRows([r]);
    expect(rejected[0].reasons.join(" ")).toMatch(/approximatif/);
  });

  it("rejette si 2 variantes AS pointent sur la meme couleur BJ", () => {
    const r = row({
      variantPairs: [
        { localColorId: "c1", ankorstoreVariantId: "v1" },
        { localColorId: "c1", ankorstoreVariantId: "v2" }, // doublon
      ],
      totalAkVariants: 2,
      bjUnitColorCount: 1,
    });
    const { rejected } = splitStrictRows([r]);
    expect(rejected[0].reasons.join(" ")).toMatch(/meme couleur chez vous/);
  });

  it("rejette si le produit BJ n'a aucune variante UNIT", () => {
    const r = row({
      variantPairs: [],
      totalAkVariants: 0,
      bjUnitColorCount: 0,
    });
    const { rejected } = splitStrictRows([r]);
    expect(rejected[0].reasons.join(" ")).toMatch(/sans variante UNIT/);
  });
});

// ─── pickRowsForUnSeul ─────────────────────────────────────────────────

describe("pickRowsForUnSeul", () => {
  const rows: MatchedRow[] = [
    {
      bjId: "bj1",
      bjName: "Robe A",
      bjReference: "RBA1",
      akId: "ak1",
      akName: "AS A",
      extractedRef: "RBA1",
      variantPairs: [],
      totalAkVariants: 0,
    },
    {
      bjId: "bj2",
      bjName: "Robe B",
      bjReference: "RBA2",
      akId: "ak2",
      akName: "AS B",
      extractedRef: "RBA2",
      variantPairs: [],
      totalAkVariants: 0,
    },
  ];

  it("retourne une ligne tiree au sort quand aucune ref n'est fournie (rng=0 → 1ere)", () => {
    const res = pickRowsForUnSeul(rows, undefined, () => 0);
    expect(res.rows).toHaveLength(1);
    expect(res.rows[0].bjReference).toBe("RBA1");
    expect(res.refNotFound).toBe(false);
  });

  it("rng proche de 1 → derniere ligne", () => {
    const res = pickRowsForUnSeul(rows, undefined, () => 0.999);
    expect(res.rows).toHaveLength(1);
    expect(res.rows[0].bjReference).toBe("RBA2");
  });

  it("retourne un tableau vide si aucune ligne disponible et pas de ref", () => {
    const res = pickRowsForUnSeul([], undefined);
    expect(res.rows).toHaveLength(0);
    expect(res.refNotFound).toBe(false);
  });

  it("filtre par reference exacte", () => {
    const res = pickRowsForUnSeul(rows, "RBA2");
    expect(res.rows).toHaveLength(1);
    expect(res.rows[0].bjId).toBe("bj2");
    expect(res.refNotFound).toBe(false);
  });

  it("normalise la comparaison (casse + espaces)", () => {
    const res = pickRowsForUnSeul(rows, "  rba1  ");
    expect(res.rows).toHaveLength(1);
    expect(res.rows[0].bjId).toBe("bj1");
  });

  it("signale refNotFound=true quand la ref n'est pas trouvee", () => {
    const res = pickRowsForUnSeul(rows, "RBA999");
    expect(res.rows).toHaveLength(0);
    expect(res.refNotFound).toBe(true);
  });

  it("plafonne a 1 ligne meme si plusieurs lignes avec la meme ref existent", () => {
    const doubled: MatchedRow[] = [rows[0], { ...rows[0], bjId: "bj1bis" }];
    const res = pickRowsForUnSeul(doubled, "RBA1");
    expect(res.rows).toHaveLength(1);
  });
});

// ─── splitAmbiguousAkSide ──────────────────────────────────────────────

describe("splitAmbiguousAkSide", () => {
  function row(bjId: string, akId: string, bjReference = "REF"): MatchedRow {
    return {
      bjId,
      bjName: `BJ ${bjId}`,
      bjReference,
      akId,
      akName: `AS ${akId}`,
      extractedRef: bjReference,
      variantPairs: [],
      totalAkVariants: 0,
    };
  }

  it("classe une ligne seule en safe", () => {
    const result = splitAmbiguousAkSide([row("bj1", "ak1")]);
    expect(result.safe).toHaveLength(1);
    expect(result.ambiguousAk).toHaveLength(0);
  });

  it("classe en ambiguousAk quand un mm bjId est match par plusieurs produits AS", () => {
    const result = splitAmbiguousAkSide([
      row("bj1", "ak1", "RBA1"),
      row("bj1", "ak2", "RBA1"),
    ]);
    expect(result.safe).toHaveLength(0);
    expect(result.ambiguousAk).toHaveLength(1);
    expect(result.ambiguousAk[0].bjId).toBe("bj1");
    expect(result.ambiguousAk[0].akCandidates).toHaveLength(2);
    expect(result.ambiguousAk[0].akCandidates.map((c) => c.id)).toEqual(["ak1", "ak2"]);
  });

  it("isole les bjId safe meme melanges avec des ambigus", () => {
    const result = splitAmbiguousAkSide([
      row("bj1", "ak1"),
      row("bj2", "ak2"),
      row("bj2", "ak3"), // bj2 = ambigu
      row("bj3", "ak4"),
    ]);
    expect(result.safe.map((r) => r.bjId).sort()).toEqual(["bj1", "bj3"]);
    expect(result.ambiguousAk).toHaveLength(1);
    expect(result.ambiguousAk[0].bjId).toBe("bj2");
  });

  it("retourne 2 listes vides quand l'entree est vide", () => {
    const result = splitAmbiguousAkSide([]);
    expect(result.safe).toHaveLength(0);
    expect(result.ambiguousAk).toHaveLength(0);
  });
});
