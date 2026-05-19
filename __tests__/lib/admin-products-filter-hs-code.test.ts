import { describe, it, expect } from "vitest";
import { buildAdminProductsWhere } from "@/lib/admin-products-filter";

describe("buildAdminProductsWhere — filtre code SH", () => {
  it("pas de filtre quand hsCodeId vide", () => {
    const where = buildAdminProductsWhere({});
    expect(where.hsCodeId).toBeUndefined();
    expect(where.AND).toBeUndefined();
  });

  it("filtre par id quand hsCodeId est un id", () => {
    const where = buildAdminProductsWhere({ hsCodeId: "abc123" });
    expect(where.hsCodeId).toBe("abc123");
  });

  it("filtre sans code SH quand __none__", () => {
    const where = buildAdminProductsWhere({ hsCodeId: "__none__" });
    const and = where.AND as Array<{ hsCodeId: null }>;
    expect(and?.some((c) => c.hsCodeId === null)).toBe(true);
  });
});
