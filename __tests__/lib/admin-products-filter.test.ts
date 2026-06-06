import { describe, it, expect, vi } from "vitest";
import {
  buildAdminProductsWhere,
  buildAdminProductsOrderBy,
  findProductIdsWithMissingVariantImages,
} from "@/lib/admin-products-filter";

describe("buildAdminProductsWhere", () => {
  it("returns an empty where when no filter is active", () => {
    expect(buildAdminProductsWhere({})).toEqual({});
  });

  it("by default: name contains OR reference startsWith (LIKE 'abc%')", () => {
    const where = buildAdminProductsWhere({ q: "abc" });
    expect(where.OR).toEqual([
      { name: { contains: "abc" } },
      { reference: { startsWith: "abc" } },
    ]);
  });

  it("applies an exact reference match (uppercased) when exactRef is true", () => {
    const where = buildAdminProductsWhere({ q: "ref-42", exactRef: true });
    expect(where).toEqual({ reference: { equals: "REF-42" } });
  });

  it("supports multiple comma-separated terms in fuzzy mode (OR across each, ref startsWith)", () => {
    const where = buildAdminProductsWhere({ q: "abc, def , ghi" });
    expect(where.OR).toEqual([
      { name: { contains: "abc" } },
      { reference: { startsWith: "abc" } },
      { name: { contains: "def" } },
      { reference: { startsWith: "def" } },
      { name: { contains: "ghi" } },
      { reference: { startsWith: "ghi" } },
    ]);
  });

  it("supports multiple comma-separated references in exactRef mode (IN, uppercased)", () => {
    const where = buildAdminProductsWhere({ q: "ref-1, ref-2", exactRef: true });
    expect(where).toEqual({ reference: { in: ["REF-1", "REF-2"] } });
  });

  it("ignores empty terms between commas", () => {
    const where = buildAdminProductsWhere({ q: ",abc,, ,def,", exactRef: true });
    expect(where).toEqual({ reference: { in: ["ABC", "DEF"] } });
  });

  it("filters by category id", () => {
    expect(buildAdminProductsWhere({ cat: "cat-1" }).categoryId).toBe("cat-1");
  });

  it("filters by sub-category via the M2M relation", () => {
    const where = buildAdminProductsWhere({ subCat: "sub-1" });
    expect(where.subCategories).toEqual({ some: { id: "sub-1" } });
  });

  it("filters by tag via the join table", () => {
    const where = buildAdminProductsWhere({ tag: "tag-1" });
    expect(where.tags).toEqual({ some: { tagId: "tag-1" } });
  });

  it("filters by composition via the join table", () => {
    const where = buildAdminProductsWhere({ composition: "comp-1" });
    expect(where.compositions).toEqual({ some: { compositionId: "comp-1" } });
  });

  it("ignores composition filter when value is empty", () => {
    expect(buildAdminProductsWhere({ composition: "" }).compositions).toBeUndefined();
  });

  it("filters best-sellers when bestSeller is '1'", () => {
    expect(buildAdminProductsWhere({ bestSeller: "1" }).isBestSeller).toBe(true);
  });

  it("ignores best-seller filter when value is empty", () => {
    expect(buildAdminProductsWhere({ bestSeller: "" }).isBestSeller).toBeUndefined();
  });

  it("filters never-refreshed products with refresh=never", () => {
    const where = buildAdminProductsWhere({ refresh: "never" });
    expect(where.lastRefreshedAt).toBeNull();
  });

  it("filters already refreshed products with refresh=refreshed", () => {
    const where = buildAdminProductsWhere({ refresh: "refreshed" });
    expect(where.lastRefreshedAt).toEqual({ not: null });
  });

  it("filters recently refreshed products (30 days window) with refresh=recent", () => {
    const now = new Date("2026-04-27T12:00:00Z");
    const where = buildAdminProductsWhere({ refresh: "recent", now });
    const expected = new Date(now);
    expected.setDate(expected.getDate() - 30);
    expect(where.lastRefreshedAt).toEqual({ gte: expected });
  });

  it("maps DRAFT status to OFFLINE + isIncomplete=true", () => {
    const where = buildAdminProductsWhere({ status: "DRAFT" });
    expect(where).toMatchObject({ status: "OFFLINE", isIncomplete: true });
  });

  it("maps OFFLINE status to OFFLINE + isIncomplete=false (excludes drafts)", () => {
    const where = buildAdminProductsWhere({ status: "OFFLINE" });
    expect(where).toMatchObject({ status: "OFFLINE", isIncomplete: false });
  });

  it("passes ONLINE / ARCHIVED through unchanged", () => {
    expect(buildAdminProductsWhere({ status: "ONLINE" }).status).toBe("ONLINE");
    expect(buildAdminProductsWhere({ status: "ARCHIVED" }).status).toBe("ARCHIVED");
  });

  it("combines price min and max into a single colors.some clause", () => {
    const where = buildAdminProductsWhere({ minPrice: 10, maxPrice: 50 });
    expect(where.colors).toEqual({ some: { unitPrice: { gte: 10, lte: 50 } } });
  });

  it("combines price and stock into the same colors.some clause", () => {
    const where = buildAdminProductsWhere({ minPrice: 10, stockBelow: 5 });
    expect(where.colors).toEqual({
      some: { unitPrice: { gte: 10 }, stock: { lte: 5 } },
    });
  });

  it("applies stock threshold alone", () => {
    const where = buildAdminProductsWhere({ stockBelow: 3 });
    expect(where.colors).toEqual({ some: { stock: { lte: 3 } } });
  });

  it("applies dateFrom and clamps dateTo to end of day", () => {
    const where = buildAdminProductsWhere({
      dateFrom: "2026-01-01",
      dateTo: "2026-01-31",
    });
    const created = where.createdAt as { gte: Date; lte: Date };
    expect(created.gte).toEqual(new Date("2026-01-01"));
    expect(created.lte.getHours()).toBe(23);
    expect(created.lte.getMinutes()).toBe(59);
  });

  it("supports several filters at once without clobbering them", () => {
    const where = buildAdminProductsWhere({
      cat: "c1",
      subCat: "s1",
      tag: "t1",
      bestSeller: "1",
      refresh: "never",
      status: "ONLINE",
    });
    expect(where).toMatchObject({
      categoryId: "c1",
      subCategories: { some: { id: "s1" } },
      tags: { some: { tagId: "t1" } },
      isBestSeller: true,
      lastRefreshedAt: null,
      status: "ONLINE",
    });
  });

  it("does not apply any lastRefreshedAt where clause for refresh=dateDesc (it's a sort, not a filter)", () => {
    const where = buildAdminProductsWhere({ refresh: "dateDesc" });
    expect(where.lastRefreshedAt).toBeUndefined();
  });

  it("does not apply any lastRefreshedAt where clause for refresh=dateAsc (it's a sort, not a filter)", () => {
    const where = buildAdminProductsWhere({ refresh: "dateAsc" });
    expect(where.lastRefreshedAt).toBeUndefined();
  });

  it("does not apply any lastRefreshedAt where clause for refresh=modifiedDesc (it's a sort, not a filter)", () => {
    const where = buildAdminProductsWhere({ refresh: "modifiedDesc" });
    expect(where.lastRefreshedAt).toBeUndefined();
  });

  it("does not apply any lastRefreshedAt where clause for refresh=modifiedAsc (it's a sort, not a filter)", () => {
    const where = buildAdminProductsWhere({ refresh: "modifiedAsc" });
    expect(where.lastRefreshedAt).toBeUndefined();
  });

  it("restricts to the given productIdsIn list when provided", () => {
    const where = buildAdminProductsWhere({ productIdsIn: ["p1", "p2"] });
    expect(where.id).toEqual({ in: ["p1", "p2"] });
  });

  it("returns no products when productIdsIn is an empty array (zero matches)", () => {
    const where = buildAdminProductsWhere({ productIdsIn: [] });
    expect(where.id).toEqual({ in: [] });
  });

  it("does not set where.id when productIdsIn is null or undefined", () => {
    expect(buildAdminProductsWhere({ productIdsIn: null }).id).toBeUndefined();
    expect(buildAdminProductsWhere({}).id).toBeUndefined();
  });

  it("combines productIdsIn with other filters without clobbering them", () => {
    const where = buildAdminProductsWhere({
      productIdsIn: ["p1"],
      cat: "c1",
      status: "ONLINE",
    });
    expect(where).toMatchObject({
      id: { in: ["p1"] },
      categoryId: "c1",
      status: "ONLINE",
    });
  });

  it("requires both product and all UNIT colors to be linked when pfsLink=linked", () => {
    const where = buildAdminProductsWhere({ pfsLink: "linked" });
    expect(where.pfsProductId).toEqual({ not: null });
    expect(where.AND).toEqual([
      { NOT: { colors: { some: { saleType: "UNIT", pfsVariantId: null } } } },
    ]);
  });

  it("matches products that are unlinked OR have at least one unlinked UNIT color when pfsLink=unlinked", () => {
    const where = buildAdminProductsWhere({ pfsLink: "unlinked" });
    expect(where.pfsProductId).toBeUndefined();
    expect(where.AND).toEqual([
      {
        OR: [
          { pfsProductId: null },
          { colors: { some: { saleType: "UNIT", pfsVariantId: null } } },
        ],
      },
    ]);
  });

  it("ignores pfsLink when value is empty or unknown", () => {
    expect(buildAdminProductsWhere({ pfsLink: "" }).pfsProductId).toBeUndefined();
    expect(buildAdminProductsWhere({ pfsLink: "lol" }).pfsProductId).toBeUndefined();
  });

  it("requires both product and all UNIT colors to be linked when ankorsLink=linked", () => {
    const where = buildAdminProductsWhere({ ankorsLink: "linked" });
    expect(where.ankorsProductId).toEqual({ not: null });
    expect(where.AND).toEqual([
      { NOT: { colors: { some: { saleType: "UNIT", ankorsVariantId: null } } } },
    ]);
  });

  it("matches products that are unlinked OR have at least one unlinked UNIT color when ankorsLink=unlinked", () => {
    const where = buildAdminProductsWhere({ ankorsLink: "unlinked" });
    expect(where.ankorsProductId).toBeUndefined();
    expect(where.AND).toEqual([
      {
        OR: [
          { ankorsProductId: null },
          { colors: { some: { saleType: "UNIT", ankorsVariantId: null } } },
        ],
      },
    ]);
  });

  it("ignores ankorsLink when value is empty or unknown", () => {
    expect(buildAdminProductsWhere({ ankorsLink: "" }).ankorsProductId).toBeUndefined();
    expect(buildAdminProductsWhere({ ankorsLink: "x" }).ankorsProductId).toBeUndefined();
  });

  it("combines pfsLink and ankorsLink without clobbering each other", () => {
    const where = buildAdminProductsWhere({ pfsLink: "linked", ankorsLink: "unlinked" });
    expect(where.pfsProductId).toEqual({ not: null });
    expect(where.AND).toEqual([
      { NOT: { colors: { some: { saleType: "UNIT", pfsVariantId: null } } } },
      {
        OR: [
          { ankorsProductId: null },
          { colors: { some: { saleType: "UNIT", ankorsVariantId: null } } },
        ],
      },
    ]);
  });

  it("requires reference base set and all UNIT colors linked when efashionLink=linked", () => {
    const where = buildAdminProductsWhere({ efashionLink: "linked" });
    expect(where.efashionReferenceBase).toEqual({ not: null });
    expect(where.AND).toEqual([
      { NOT: { colors: { some: { saleType: "UNIT", efashionProductId: null } } } },
    ]);
  });

  it("matches products without reference base OR with at least one unlinked UNIT color when efashionLink=unlinked", () => {
    const where = buildAdminProductsWhere({ efashionLink: "unlinked" });
    expect(where.efashionReferenceBase).toBeUndefined();
    expect(where.AND).toEqual([
      {
        OR: [
          { efashionReferenceBase: null },
          { colors: { some: { saleType: "UNIT", efashionProductId: null } } },
        ],
      },
    ]);
  });

  it("ignores efashionLink when value is empty or unknown", () => {
    expect(buildAdminProductsWhere({ efashionLink: "" }).efashionReferenceBase).toBeUndefined();
    expect(buildAdminProductsWhere({ efashionLink: "nope" }).efashionReferenceBase).toBeUndefined();
  });

  it("combines all three marketplace filters without clobbering each other", () => {
    const where = buildAdminProductsWhere({
      pfsLink: "linked",
      ankorsLink: "linked",
      efashionLink: "unlinked",
    });
    expect(where.pfsProductId).toEqual({ not: null });
    expect(where.ankorsProductId).toEqual({ not: null });
    expect(where.efashionReferenceBase).toBeUndefined();
    expect(where.AND).toEqual([
      { NOT: { colors: { some: { saleType: "UNIT", pfsVariantId: null } } } },
      { NOT: { colors: { some: { saleType: "UNIT", ankorsVariantId: null } } } },
      {
        OR: [
          { efashionReferenceBase: null },
          { colors: { some: { saleType: "UNIT", efashionProductId: null } } },
        ],
      },
    ]);
  });
});

describe("findProductIdsWithMissingVariantImages", () => {
  it("returns the productIds reported by the raw query", async () => {
    const $queryRaw = vi.fn().mockResolvedValue([
      { productId: "p1" },
      { productId: "p2" },
    ]);
    const ids = await findProductIdsWithMissingVariantImages({ $queryRaw } as never);
    expect(ids).toEqual(["p1", "p2"]);
    expect($queryRaw).toHaveBeenCalledTimes(1);
  });

  it("returns an empty array when no product has a variant without images", async () => {
    const $queryRaw = vi.fn().mockResolvedValue([]);
    const ids = await findProductIdsWithMissingVariantImages({ $queryRaw } as never);
    expect(ids).toEqual([]);
  });
});

describe("buildAdminProductsOrderBy", () => {
  it("defaults to createdAt desc when no refresh value is given", () => {
    expect(buildAdminProductsOrderBy()).toEqual([{ createdAt: "desc" }]);
  });

  it("defaults to createdAt desc for empty / filter-only refresh values", () => {
    expect(buildAdminProductsOrderBy("")).toEqual([{ createdAt: "desc" }]);
    expect(buildAdminProductsOrderBy("never")).toEqual([{ createdAt: "desc" }]);
    expect(buildAdminProductsOrderBy("refreshed")).toEqual([{ createdAt: "desc" }]);
    expect(buildAdminProductsOrderBy("recent")).toEqual([{ createdAt: "desc" }]);
  });

  it("sorts by lastRefreshedAt desc with never-refreshed products last for refresh=dateDesc", () => {
    expect(buildAdminProductsOrderBy("dateDesc")).toEqual([
      { lastRefreshedAt: { sort: "desc", nulls: "last" } },
      { createdAt: "desc" },
    ]);
  });

  it("sorts by lastRefreshedAt asc with never-refreshed products last for refresh=dateAsc", () => {
    expect(buildAdminProductsOrderBy("dateAsc")).toEqual([
      { lastRefreshedAt: { sort: "asc", nulls: "last" } },
      { createdAt: "asc" },
    ]);
  });

  it("sorts by updatedAt desc for refresh=modifiedDesc (most recently edited first)", () => {
    expect(buildAdminProductsOrderBy("modifiedDesc")).toEqual([
      { updatedAt: "desc" },
    ]);
  });

  it("sorts by updatedAt asc for refresh=modifiedAsc (oldest edited first)", () => {
    expect(buildAdminProductsOrderBy("modifiedAsc")).toEqual([
      { updatedAt: "asc" },
    ]);
  });
});
