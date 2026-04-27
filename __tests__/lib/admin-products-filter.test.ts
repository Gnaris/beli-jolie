import { describe, it, expect } from "vitest";
import { buildAdminProductsWhere } from "@/lib/admin-products-filter";

describe("buildAdminProductsWhere", () => {
  it("returns an empty where when no filter is active", () => {
    expect(buildAdminProductsWhere({})).toEqual({});
  });

  it("applies a contains search on name and reference by default", () => {
    const where = buildAdminProductsWhere({ q: "abc" });
    expect(where.OR).toEqual([
      { name: { contains: "abc" } },
      { reference: { contains: "abc" } },
    ]);
  });

  it("applies an exact reference match (uppercased) when exactRef is true", () => {
    const where = buildAdminProductsWhere({ q: "ref-42", exactRef: true });
    expect(where).toEqual({ reference: { equals: "REF-42" } });
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

  it("passes ONLINE / ARCHIVED / SYNCING through unchanged", () => {
    expect(buildAdminProductsWhere({ status: "ONLINE" }).status).toBe("ONLINE");
    expect(buildAdminProductsWhere({ status: "ARCHIVED" }).status).toBe("ARCHIVED");
    expect(buildAdminProductsWhere({ status: "SYNCING" }).status).toBe("SYNCING");
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
});
