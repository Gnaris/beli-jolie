import { describe, it, expect } from "vitest";
import {
  evaluateProductAgainstRule,
  isRuleEmpty,
  normalizeRuleInput,
  parseStoredRule,
  buildProductWhereForRule,
  type CollectionRuleShape,
  type ProductForRuleEvaluation,
} from "@/lib/collection-rules";

// ── Helpers ─────────────────────────────────────────────────────────────────

const emptyRule: CollectionRuleShape = {
  seasonId: null,
  categoryIds: [],
  subCategoryIds: [],
  tagIds: [],
  compositions: [],
};

function rule(over: Partial<CollectionRuleShape>): CollectionRuleShape {
  return { ...emptyRule, ...over };
}

function product(over: Partial<ProductForRuleEvaluation>): ProductForRuleEvaluation {
  return {
    status: "ONLINE",
    seasonId: null,
    categoryId: "cat-default",
    subCategories: [],
    tags: [],
    compositions: [],
    ...over,
  };
}

// ── isRuleEmpty ─────────────────────────────────────────────────────────────

describe("isRuleEmpty", () => {
  it("renvoie true pour une règle sans aucun critère", () => {
    expect(isRuleEmpty(emptyRule)).toBe(true);
  });
  it("renvoie false dès qu'un critère est posé", () => {
    expect(isRuleEmpty(rule({ seasonId: "s1" }))).toBe(false);
    expect(isRuleEmpty(rule({ categoryIds: ["c1"] }))).toBe(false);
    expect(isRuleEmpty(rule({ tagIds: ["t1"] }))).toBe(false);
    expect(isRuleEmpty(rule({ subCategoryIds: ["sc1"] }))).toBe(false);
    expect(isRuleEmpty(rule({ compositions: [{ compositionId: "co1" }] }))).toBe(false);
  });
});

// ── normalizeRuleInput ──────────────────────────────────────────────────────

describe("normalizeRuleInput", () => {
  it("dédoublonne les listes et vire les vides", () => {
    const out = normalizeRuleInput({
      categoryIds: ["c1", "c1", "c2", ""],
      tagIds: [""],
      subCategoryIds: ["sc1", "sc2", "sc1"],
    });
    expect(out.categoryIds).toEqual(["c1", "c2"]);
    expect(out.tagIds).toEqual([]);
    expect(out.subCategoryIds).toEqual(["sc1", "sc2"]);
  });
  it("filtre les compositions sans compositionId valide", () => {
    const out = normalizeRuleInput({
      compositions: [
        { compositionId: "co1", minPercent: 75 },
        { compositionId: "" },
        { compositionId: "co2" },
      ],
    });
    expect(out.compositions).toEqual([
      { compositionId: "co1", minPercent: 75 },
      { compositionId: "co2" },
    ]);
  });
  it("seasonId null par défaut", () => {
    expect(normalizeRuleInput({}).seasonId).toBeNull();
  });
});

// ── parseStoredRule ─────────────────────────────────────────────────────────

describe("parseStoredRule", () => {
  it("parse correctement les colonnes JSON", () => {
    const shape = parseStoredRule({
      seasonId: "s1",
      categoryIds: ["c1", "c2"],
      subCategoryIds: null,
      tagIds: ["t1"],
      compositions: [
        { compositionId: "co1", minPercent: 75 },
        { compositionId: "co2" },
      ],
    });
    expect(shape.seasonId).toBe("s1");
    expect(shape.categoryIds).toEqual(["c1", "c2"]);
    expect(shape.subCategoryIds).toEqual([]);
    expect(shape.tagIds).toEqual(["t1"]);
    expect(shape.compositions).toEqual([
      { compositionId: "co1", minPercent: 75 },
      { compositionId: "co2", minPercent: undefined },
    ]);
  });
  it("ignore les compositions mal formées", () => {
    const shape = parseStoredRule({
      seasonId: null,
      categoryIds: null,
      subCategoryIds: null,
      tagIds: null,
      compositions: [{ compositionId: "" }, "junk", { foo: "bar" }, { compositionId: "co1" }],
    });
    expect(shape.compositions).toEqual([{ compositionId: "co1", minPercent: undefined }]);
  });
});

// ── evaluateProductAgainstRule ──────────────────────────────────────────────

describe("evaluateProductAgainstRule", () => {
  it("renvoie false si produit non ONLINE (même si la règle matche partout)", () => {
    const p = product({ status: "OFFLINE", seasonId: "s1", categoryId: "c1" });
    expect(evaluateProductAgainstRule(p, rule({ seasonId: "s1" }))).toBe(false);
  });

  it("renvoie false si règle vide (jamais TOUS les produits)", () => {
    expect(evaluateProductAgainstRule(product({}), emptyRule)).toBe(false);
  });

  describe("saison", () => {
    it("matche si la saison correspond", () => {
      const p = product({ seasonId: "auto" });
      expect(evaluateProductAgainstRule(p, rule({ seasonId: "auto" }))).toBe(true);
    });
    it("ne matche pas si la saison diffère", () => {
      const p = product({ seasonId: "hiver" });
      expect(evaluateProductAgainstRule(p, rule({ seasonId: "auto" }))).toBe(false);
    });
    it("ne matche pas si la saison est absente du produit alors qu'elle est requise", () => {
      const p = product({ seasonId: null });
      expect(evaluateProductAgainstRule(p, rule({ seasonId: "auto" }))).toBe(false);
    });
    it("ignore le critère saison quand la règle n'en pose pas", () => {
      const p = product({ seasonId: "hiver", categoryId: "c1" });
      expect(evaluateProductAgainstRule(p, rule({ categoryIds: ["c1"] }))).toBe(true);
    });
  });

  describe("catégories (OU implicite)", () => {
    it("matche si la catégorie produit est dans la liste", () => {
      const p = product({ categoryId: "c2" });
      expect(evaluateProductAgainstRule(p, rule({ categoryIds: ["c1", "c2", "c3"] }))).toBe(true);
    });
    it("ne matche pas si la catégorie n'est pas dans la liste", () => {
      const p = product({ categoryId: "c4" });
      expect(evaluateProductAgainstRule(p, rule({ categoryIds: ["c1", "c2"] }))).toBe(false);
    });
  });

  describe("sous-catégories (OU implicite)", () => {
    it("matche si le produit a au moins une des sous-catégories", () => {
      const p = product({ subCategories: [{ id: "sc1" }, { id: "sc9" }] });
      expect(evaluateProductAgainstRule(p, rule({ subCategoryIds: ["sc1", "sc2"] }))).toBe(true);
    });
    it("ne matche pas sinon", () => {
      const p = product({ subCategories: [{ id: "sc9" }] });
      expect(evaluateProductAgainstRule(p, rule({ subCategoryIds: ["sc1", "sc2"] }))).toBe(false);
    });
  });

  describe("tags (OU implicite)", () => {
    it("matche si le produit a au moins un des tags", () => {
      const p = product({ tags: [{ tagId: "doré" }] });
      expect(evaluateProductAgainstRule(p, rule({ tagIds: ["doré", "argenté"] }))).toBe(true);
    });
    it("ne matche pas si aucun tag ne correspond", () => {
      const p = product({ tags: [{ tagId: "cuir" }] });
      expect(evaluateProductAgainstRule(p, rule({ tagIds: ["doré", "argenté"] }))).toBe(false);
    });
  });

  describe("compositions (ET entre lignes, seuil optionnel)", () => {
    it("matche si le produit contient la compo (sans seuil)", () => {
      const p = product({ compositions: [{ compositionId: "argent", percentage: 40 }] });
      expect(
        evaluateProductAgainstRule(p, rule({ compositions: [{ compositionId: "argent" }] })),
      ).toBe(true);
    });
    it("ne matche pas si la compo est absente du produit", () => {
      const p = product({ compositions: [{ compositionId: "or", percentage: 100 }] });
      expect(
        evaluateProductAgainstRule(p, rule({ compositions: [{ compositionId: "argent" }] })),
      ).toBe(false);
    });
    it("respecte le seuil minPercent", () => {
      const p = product({ compositions: [{ compositionId: "argent", percentage: 70 }] });
      expect(
        evaluateProductAgainstRule(
          p,
          rule({ compositions: [{ compositionId: "argent", minPercent: 75 }] }),
        ),
      ).toBe(false);
      expect(
        evaluateProductAgainstRule(
          p,
          rule({ compositions: [{ compositionId: "argent", minPercent: 70 }] }),
        ),
      ).toBe(true);
    });
    it("toutes les lignes de compo doivent matcher (ET)", () => {
      const p = product({
        compositions: [
          { compositionId: "argent", percentage: 80 },
          { compositionId: "zircon", percentage: 5 },
        ],
      });
      // Les deux présentes → OK
      expect(
        evaluateProductAgainstRule(
          p,
          rule({
            compositions: [
              { compositionId: "argent", minPercent: 75 },
              { compositionId: "zircon" },
            ],
          }),
        ),
      ).toBe(true);
      // Une manque → refus
      expect(
        evaluateProductAgainstRule(
          p,
          rule({
            compositions: [
              { compositionId: "argent" },
              { compositionId: "or" },
            ],
          }),
        ),
      ).toBe(false);
    });
  });

  describe("combinaison ET stricte", () => {
    it("matche uniquement si TOUTES les conditions sont vraies", () => {
      const p = product({
        seasonId: "auto",
        categoryId: "boucles",
        tags: [{ tagId: "doré" }],
        compositions: [{ compositionId: "argent", percentage: 92 }],
      });
      const r = rule({
        seasonId: "auto",
        categoryIds: ["boucles", "colliers"],
        tagIds: ["doré", "argenté"],
        compositions: [{ compositionId: "argent", minPercent: 75 }],
      });
      expect(evaluateProductAgainstRule(p, r)).toBe(true);
    });
    it("refuse si une condition seule échoue", () => {
      const p = product({
        seasonId: "hiver", // ← saison ne matche pas
        categoryId: "boucles",
        tags: [{ tagId: "doré" }],
      });
      const r = rule({
        seasonId: "auto",
        categoryIds: ["boucles"],
        tagIds: ["doré"],
      });
      expect(evaluateProductAgainstRule(p, r)).toBe(false);
    });
  });
});

// ── buildProductWhereForRule ────────────────────────────────────────────────

describe("buildProductWhereForRule", () => {
  it("restreint toujours au statut ONLINE", () => {
    const where = buildProductWhereForRule(rule({ seasonId: "s1" }));
    expect((where.AND as unknown[])?.[0]).toEqual({ status: "ONLINE" });
  });
  it("ajoute un filtre saison quand présent", () => {
    const where = buildProductWhereForRule(rule({ seasonId: "s1" }));
    const conditions = where.AND as Record<string, unknown>[];
    expect(conditions).toContainEqual({ seasonId: "s1" });
  });
  it("ajoute un IN sur categoryId pour plusieurs catégories", () => {
    const where = buildProductWhereForRule(rule({ categoryIds: ["c1", "c2"] }));
    const conditions = where.AND as Record<string, unknown>[];
    expect(conditions).toContainEqual({ categoryId: { in: ["c1", "c2"] } });
  });
  it("génère un some/some pour tags", () => {
    const where = buildProductWhereForRule(rule({ tagIds: ["t1", "t2"] }));
    const conditions = where.AND as Record<string, unknown>[];
    expect(conditions).toContainEqual({ tags: { some: { tagId: { in: ["t1", "t2"] } } } });
  });
  it("génère un some par ligne de composition, avec gte quand minPercent est posé", () => {
    const where = buildProductWhereForRule(
      rule({
        compositions: [
          { compositionId: "argent", minPercent: 75 },
          { compositionId: "zircon" },
        ],
      }),
    );
    const conditions = where.AND as Record<string, unknown>[];
    expect(conditions).toContainEqual({
      compositions: { some: { compositionId: "argent", percentage: { gte: 75 } } },
    });
    expect(conditions).toContainEqual({
      compositions: { some: { compositionId: "zircon" } },
    });
  });
});
