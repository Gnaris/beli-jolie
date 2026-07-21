import { describe, it, expect } from "vitest";
import {
  decideEfashionLink,
  normalizeEfashionColorName,
  computeEfashionReferenceBase,
  type EfashionMatchProduct,
  type EfashionMatchCandidate,
} from "@/lib/efashion-link-match";

function buildProduct(overrides: Partial<EfashionMatchProduct> = {}): EfashionMatchProduct {
  return {
    id: "p1",
    reference: "A2415-DORE",
    category: { name: "Bracelets", efashionCategorieId: 100 },
    country: { name: "Chine", efashionProvenanceId: 200 },
    season: { name: "PE26", efashionCollectionId: 300 },
    compositions: [
      { composition: { name: "Acier", efashionId: 400 } },
    ],
    colors: [
      {
        saleType: "UNIT",
        color: { id: "c-or", name: "Doré", efashionColorId: 500 },
      },
    ],
    ...overrides,
  };
}

function buildCandidate(overrides: Partial<EfashionMatchCandidate> = {}): EfashionMatchCandidate {
  return {
    id_produit: 9001,
    id_couleur: 500,
    couleur: "Doré",
    reference_base: "A2415",
    ...overrides,
  };
}

describe("normalizeEfashionColorName", () => {
  it("strips accents, lowercases and trims", () => {
    expect(normalizeEfashionColorName("Doré")).toBe("dore");
    expect(normalizeEfashionColorName("  ROUGE FONCÉ  ")).toBe("rouge fonce");
    expect(normalizeEfashionColorName("Œil-de-tigre")).toBe("œil-de-tigre");
  });
});

describe("computeEfashionReferenceBase", () => {
  it("returns the part before the first - or _", () => {
    expect(computeEfashionReferenceBase("A2415-DORE")).toBe("A2415");
    expect(computeEfashionReferenceBase("A2415_NOIR")).toBe("A2415");
    expect(computeEfashionReferenceBase("A2415")).toBe("A2415");
  });

  it("trims surrounding whitespace", () => {
    expect(computeEfashionReferenceBase("  A2415-DORE  ")).toBe("A2415");
  });
});

describe("decideEfashionLink", () => {
  it("links a product whose unique UNIT color matches a single candidate by name", () => {
    const decision = decideEfashionLink(buildProduct(), [buildCandidate()]);
    expect(decision).toEqual({
      status: "linked",
      referenceBase: "A2415",
      links: [
        {
          localColorId: "c-or",
          efashionProductId: 9001,
          efashionColorId: 500,
        },
      ],
    });
  });

  it("matches colors despite accents and casing differences", () => {
    const decision = decideEfashionLink(
      buildProduct({
        colors: [
          {
            saleType: "UNIT",
            color: { id: "c-or", name: "Doré", efashionColorId: 500 },
          },
        ],
      }),
      [buildCandidate({ couleur: "DORE" })],
    );
    expect(decision.status).toBe("linked");
  });

  it("links a multi-color product when every color has exactly one match", () => {
    const product = buildProduct({
      colors: [
        { saleType: "UNIT", color: { id: "c-or", name: "Doré", efashionColorId: 500 } },
        { saleType: "UNIT", color: { id: "c-arg", name: "Argenté", efashionColorId: 501 } },
      ],
    });
    const candidates = [
      buildCandidate({ id_produit: 9001, id_couleur: 500, couleur: "Doré" }),
      buildCandidate({ id_produit: 9002, id_couleur: 501, couleur: "Argenté" }),
    ];
    const decision = decideEfashionLink(product, candidates);
    expect(decision.status).toBe("linked");
    if (decision.status !== "linked") return;
    expect(decision.links).toHaveLength(2);
    expect(decision.links.map((l) => l.efashionProductId).sort()).toEqual([9001, 9002]);
  });

  it("rejects when product has no UNIT colors (PACK only)", () => {
    const decision = decideEfashionLink(
      buildProduct({
        colors: [
          { saleType: "PACK", color: { id: "c-or", name: "Doré", efashionColorId: 500 } },
        ],
      }),
      [buildCandidate()],
    );
    expect(decision).toEqual({ status: "skipped_no_unit" });
  });

  it("reports missing category mapping", () => {
    const decision = decideEfashionLink(
      buildProduct({ category: { name: "Bracelets", efashionCategorieId: null } }),
      [buildCandidate()],
    );
    expect(decision.status).toBe("skipped_missing_attrs");
    if (decision.status !== "skipped_missing_attrs") return;
    expect(decision.reasons[0]).toContain("Catégorie");
  });

  it("reports missing color mapping", () => {
    const decision = decideEfashionLink(
      buildProduct({
        colors: [
          { saleType: "UNIT", color: { id: "c-or", name: "Doré", efashionColorId: null } },
        ],
      }),
      [buildCandidate()],
    );
    expect(decision.status).toBe("skipped_missing_attrs");
    if (decision.status !== "skipped_missing_attrs") return;
    expect(decision.reasons.some((r) => r.includes("Couleur"))).toBe(true);
  });

  it("returns skipped_no_match when no candidate has the exact reference_base", () => {
    const decision = decideEfashionLink(buildProduct(), [
      buildCandidate({ reference_base: "A24150" }), // partial match
      buildCandidate({ reference_base: "A24151" }),
    ]);
    expect(decision).toEqual({ status: "skipped_no_match", referenceBase: "A2415" });
  });

  it("returns ambiguous when a local color has no eFashion equivalent", () => {
    const decision = decideEfashionLink(
      buildProduct({
        colors: [
          { saleType: "UNIT", color: { id: "c-or", name: "Doré", efashionColorId: 500 } },
          { saleType: "UNIT", color: { id: "c-arg", name: "Argenté", efashionColorId: 501 } },
        ],
      }),
      [buildCandidate({ couleur: "Doré" })], // Argenté missing on eFashion
    );
    expect(decision.status).toBe("skipped_ambiguous");
    if (decision.status !== "skipped_ambiguous") return;
    expect(decision.reason).toContain("Argenté");
  });

  it("returns ambiguous when an eFashion line has no BJ equivalent (orphan)", () => {
    const decision = decideEfashionLink(buildProduct(), [
      buildCandidate({ id_produit: 9001, couleur: "Doré" }),
      buildCandidate({ id_produit: 9002, couleur: "Bleu" }), // orphan
    ]);
    expect(decision.status).toBe("skipped_ambiguous");
    if (decision.status !== "skipped_ambiguous") return;
    expect(decision.reason).toContain("Bleu");
  });

  it("returns ambiguous when two eFashion lines share the same normalized color name", () => {
    const decision = decideEfashionLink(buildProduct(), [
      buildCandidate({ id_produit: 9001, couleur: "Doré" }),
      buildCandidate({ id_produit: 9002, couleur: "DORE" }), // same normalized name
    ]);
    expect(decision.status).toBe("skipped_ambiguous");
    if (decision.status !== "skipped_ambiguous") return;
    expect(decision.reason).toContain("ambigu");
  });

  it("does not auto-link if eFashion returns no candidates", () => {
    const decision = decideEfashionLink(buildProduct(), []);
    expect(decision).toEqual({ status: "skipped_no_match", referenceBase: "A2415" });
  });

  it("ignores PACK variants when validating colors (no false missing-mapping)", () => {
    const decision = decideEfashionLink(
      buildProduct({
        colors: [
          { saleType: "UNIT", color: { id: "c-or", name: "Doré", efashionColorId: 500 } },
          // PACK variant without efashionColorId — should NOT trigger missing-attrs
          { saleType: "PACK", color: { id: "c-pack", name: "Mix", efashionColorId: null } },
        ],
      }),
      [buildCandidate()],
    );
    expect(decision.status).toBe("linked");
  });

  it("filters out partial reference_base matches", () => {
    // eFashion's `reference` filter is a 'contains' filter — we must still
    // refuse to match A2415 against A24150 / A24151.
    const decision = decideEfashionLink(buildProduct(), [
      buildCandidate({ reference_base: "A2415" }), // exact
      buildCandidate({ id_produit: 9999, reference_base: "A24150", couleur: "Doré" }),
    ]);
    expect(decision.status).toBe("linked");
    if (decision.status !== "linked") return;
    expect(decision.links[0].efashionProductId).toBe(9001);
  });
});
