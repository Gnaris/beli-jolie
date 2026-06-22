import { describe, it, expect } from "vitest";
import { parseQuery, shouldRefetchAfterBadgeRemove } from "@/components/admin/products/AdminProductsFilters";

describe("parseQuery", () => {
  it("returns an empty list for an empty string", () => {
    expect(parseQuery("")).toEqual([]);
  });

  it("splits comma-separated references and trims whitespace", () => {
    expect(parseQuery("REF1, REF2 ,REF3")).toEqual(["REF1", "REF2", "REF3"]);
  });

  it("ignores empty segments produced by stray commas", () => {
    expect(parseQuery(",REF1,, ,REF2,")).toEqual(["REF1", "REF2"]);
  });
});

describe("shouldRefetchAfterBadgeRemove", () => {
  it("returns false when the removed term is undefined (out-of-range index)", () => {
    expect(shouldRefetchAfterBadgeRemove(undefined, "REF1,REF2")).toBe(false);
  });

  it("returns true when the removed term is part of the active URL search", () => {
    expect(shouldRefetchAfterBadgeRemove("REF1", "REF1,REF2")).toBe(true);
  });

  it("returns false when the removed badge was only local (not in URL yet)", () => {
    // L'utilisatrice a tapé une référence et appuyé sur Tab : le badge existe
    // en local mais la recherche n'a pas encore été lancée. Le retirer ne doit
    // pas déclencher de navigation surprise.
    expect(shouldRefetchAfterBadgeRemove("REF3", "REF1,REF2")).toBe(false);
  });

  it("handles whitespace around URL terms correctly", () => {
    expect(shouldRefetchAfterBadgeRemove("REF1", " REF1 , REF2 ")).toBe(true);
  });

  it("returns false when URL has no active query", () => {
    expect(shouldRefetchAfterBadgeRemove("REF1", "")).toBe(false);
  });
});
