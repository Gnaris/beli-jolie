import { describe, it, expect } from "vitest";
import { buildAdminProductsWhere } from "@/lib/admin-products-filter";

/**
 * Filtres « Sans <attribut> » ajoutés à la demande de la cliente : dans le
 * panneau Catalogue, chaque select facultatif expose « Sans sous-catégorie »,
 * « Sans composition », « Sans mot-clé ». Le sentinelle URL est "__none__" —
 * on vérifie que `buildAdminProductsWhere` le traduit en clause `none: {}`.
 *
 * NB : la catégorie principale (`categoryId`) est obligatoire côté schéma
 * Prisma → pas d'option « Sans catégorie ».
 */
describe("buildAdminProductsWhere — filtres « Sans <attribut> »", () => {
  it("subCat=__none__ → subCategories.none", () => {
    const where = buildAdminProductsWhere({ subCat: "__none__" });
    expect(where.subCategories).toEqual({ none: {} });
  });

  it("subCat=<id> → subCategories.some.id", () => {
    const where = buildAdminProductsWhere({ subCat: "sub-abc" });
    expect(where.subCategories).toEqual({ some: { id: "sub-abc" } });
  });

  it("tag=__none__ → tags.none", () => {
    const where = buildAdminProductsWhere({ tag: "__none__" });
    expect(where.tags).toEqual({ none: {} });
  });

  it("tag=<id> → tags.some.tagId", () => {
    const where = buildAdminProductsWhere({ tag: "tag-abc" });
    expect(where.tags).toEqual({ some: { tagId: "tag-abc" } });
  });

  it("composition=__none__ → compositions.none", () => {
    const where = buildAdminProductsWhere({ composition: "__none__" });
    expect(where.compositions).toEqual({ none: {} });
  });

  it("composition=<id> → compositions.some.compositionId", () => {
    const where = buildAdminProductsWhere({ composition: "comp-abc" });
    expect(where.compositions).toEqual({ some: { compositionId: "comp-abc" } });
  });

  it("cat=<id> → categoryId direct", () => {
    const where = buildAdminProductsWhere({ cat: "cat-abc" });
    expect(where.categoryId).toBe("cat-abc");
  });

  it("cat vide → pas de filtre", () => {
    const where = buildAdminProductsWhere({ cat: "" });
    expect(where.categoryId).toBeUndefined();
  });

  it("cat=__none__ → id sentinelle (0 résultat sur base propre)", () => {
    // La contrainte FK garantit qu'aucun produit ne pointe vers cet id ;
    // on retombe donc sur 0 résultat sur une base propre. Si un jour une
    // donnée orpheline traîne, elle serait remontée par ce filtre.
    const where = buildAdminProductsWhere({ cat: "__none__" });
    expect(where.categoryId).toBe("__no_category__");
  });
});
