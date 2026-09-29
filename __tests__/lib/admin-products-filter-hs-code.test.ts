import { describe, it, expect } from "vitest";
import { buildAdminProductsWhere } from "@/lib/admin-products-filter";
import type { Prisma } from "@prisma/client";

function firstAndOr(where: Prisma.ProductWhereInput): Prisma.ProductWhereInput | undefined {
  const and = where.AND;
  if (Array.isArray(and) && and.length > 0) return and[0] as Prisma.ProductWhereInput;
  return undefined;
}

// Depuis 2026-09-29 le filtre code SH accepte la multi-sélection. Sans __none__
// on écrit directement à la racine ; avec __none__ combiné à des IDs, on wrappe
// dans AND[] avec un OR pour garder la sémantique « sans code SH OU dans la liste ».
describe("buildAdminProductsWhere — filtre code SH", () => {
  it("pas de filtre quand hsCodeId vide", () => {
    const where = buildAdminProductsWhere({});
    expect(where.hsCodeId).toBeUndefined();
    expect(where.AND).toBeUndefined();
  });

  it("filtre par id unique → racine", () => {
    const where = buildAdminProductsWhere({ hsCodeId: "abc123" });
    expect(where.hsCodeId).toBe("abc123");
  });

  it("filtre par plusieurs ids → hsCodeId.in racine", () => {
    const where = buildAdminProductsWhere({ hsCodeId: "id-a,id-b" });
    expect(where.hsCodeId).toEqual({ in: ["id-a", "id-b"] });
  });

  it("filtre sans code SH (hsCodeId=null) via AND[] (racine réservée aux IDs)", () => {
    const where = buildAdminProductsWhere({ hsCodeId: "__none__" });
    expect(firstAndOr(where)).toEqual({ hsCodeId: null });
  });

  it("filtre __none__ combiné avec un id → OR wrappé dans AND", () => {
    const where = buildAdminProductsWhere({ hsCodeId: "__none__,id-a" });
    expect(firstAndOr(where)).toEqual({
      OR: [{ hsCodeId: null }, { hsCodeId: "id-a" }],
    });
  });
});
