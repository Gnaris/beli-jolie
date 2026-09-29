import { describe, it, expect } from "vitest";
import { buildAdminProductsWhere, parseMultiParam } from "@/lib/admin-products-filter";
import type { Prisma } from "@prisma/client";

/**
 * Filtres « Sans <attribut> » et multi-sélection (2026-09-29).
 *
 * Depuis le passage en cases à cocher, les 5 filtres Catalogue (cat, subCat,
 * tag, composition, hsCodeId) acceptent une liste sérialisée en virgule :
 *   « id1,id2,__none__ »
 * Le backend combine `__none__` avec les IDs réels en OR (sinon cocher
 * « Sans sous-cat » ET « Chevalière » ne remonterait rien). Sans __none__, la
 * clause est posée directement à la racine — shape Prisma la plus simple.
 */

function firstAndOr(where: Prisma.ProductWhereInput): Prisma.ProductWhereInput | undefined {
  const and = where.AND;
  if (Array.isArray(and) && and.length > 0) return and[0] as Prisma.ProductWhereInput;
  return undefined;
}

describe("parseMultiParam", () => {
  it("retourne { includeNone:false, ids:[] } sur valeur vide", () => {
    expect(parseMultiParam("")).toEqual({ includeNone: false, ids: [] });
    expect(parseMultiParam(undefined)).toEqual({ includeNone: false, ids: [] });
  });

  it("découpe une liste séparée par virgule et dédoublonne", () => {
    expect(parseMultiParam("a,b,a,c")).toEqual({ includeNone: false, ids: ["a", "b", "c"] });
  });

  it("détecte __none__ dans la liste et le sépare des IDs réels", () => {
    expect(parseMultiParam("__none__,a,b")).toEqual({ includeNone: true, ids: ["a", "b"] });
    expect(parseMultiParam("__none__")).toEqual({ includeNone: true, ids: [] });
  });

  it("ignore les segments vides ou espaces", () => {
    expect(parseMultiParam("a, ,b,")).toEqual({ includeNone: false, ids: ["a", "b"] });
  });
});

describe("buildAdminProductsWhere — sous-catégorie multi-sélection", () => {
  it("subCat=__none__ → subCategories.none direct", () => {
    const where = buildAdminProductsWhere({ subCat: "__none__" });
    expect(where.subCategories).toEqual({ none: {} });
  });

  it("subCat=<id> → subCategories.some.id direct", () => {
    const where = buildAdminProductsWhere({ subCat: "sub-abc" });
    expect(where.subCategories).toEqual({ some: { id: "sub-abc" } });
  });

  it("subCat=<id1>,<id2> → subCategories.some.id.in direct", () => {
    const where = buildAdminProductsWhere({ subCat: "sub-a,sub-b" });
    expect(where.subCategories).toEqual({ some: { id: { in: ["sub-a", "sub-b"] } } });
  });

  it("subCat=__none__,<id> → OR wrappé dans AND", () => {
    const where = buildAdminProductsWhere({ subCat: "__none__,sub-a" });
    expect(firstAndOr(where)).toEqual({
      OR: [
        { subCategories: { none: {} } },
        { subCategories: { some: { id: "sub-a" } } },
      ],
    });
  });
});

describe("buildAdminProductsWhere — tag multi-sélection", () => {
  it("tag=__none__ → tags.none direct", () => {
    const where = buildAdminProductsWhere({ tag: "__none__" });
    expect(where.tags).toEqual({ none: {} });
  });

  it("tag=<id1>,<id2>,<id3> → tags.some.tagId.in", () => {
    const where = buildAdminProductsWhere({ tag: "t1,t2,t3" });
    expect(where.tags).toEqual({ some: { tagId: { in: ["t1", "t2", "t3"] } } });
  });
});

describe("buildAdminProductsWhere — composition multi-sélection", () => {
  it("composition=<id1>,<id2> → compositions.some.compositionId.in", () => {
    const where = buildAdminProductsWhere({ composition: "c1,c2" });
    expect(where.compositions).toEqual({ some: { compositionId: { in: ["c1", "c2"] } } });
  });
});

describe("buildAdminProductsWhere — catégorie multi-sélection", () => {
  it("cat vide → aucune clause", () => {
    const where = buildAdminProductsWhere({ cat: "" });
    expect(where.categoryId).toBeUndefined();
    expect(where.AND).toBeUndefined();
  });

  it("cat=<id> → categoryId égalité directe", () => {
    const where = buildAdminProductsWhere({ cat: "cat-abc" });
    expect(where.categoryId).toBe("cat-abc");
  });

  it("cat=<id1>,<id2> → categoryId.in direct", () => {
    const where = buildAdminProductsWhere({ cat: "cat-a,cat-b" });
    expect(where.categoryId).toEqual({ in: ["cat-a", "cat-b"] });
  });

  it("cat=__none__ → id sentinelle (0 résultat sur base propre)", () => {
    const where = buildAdminProductsWhere({ cat: "__none__" });
    expect(where.categoryId).toBe("__no_category__");
  });

  it("cat=__none__,<id> → OR wrappé dans AND", () => {
    const where = buildAdminProductsWhere({ cat: "__none__,cat-a" });
    expect(firstAndOr(where)).toEqual({
      OR: [
        { categoryId: "__no_category__" },
        { categoryId: "cat-a" },
      ],
    });
  });
});
