import { describe, it, expect } from "vitest";
import { isBlankProductsUrl } from "@/components/admin/products/AdminProductsFilterPersistence";

describe("isBlankProductsUrl", () => {
  it("is true when there is nothing in the URL", () => {
    expect(isBlankProductsUrl(new URLSearchParams(""))).toBe(true);
  });

  it("is true when only tab=produits is set (default tab, equivalent to no tab)", () => {
    expect(isBlankProductsUrl(new URLSearchParams("tab=produits"))).toBe(true);
  });

  it("is true when a non-tab parameter is present but empty", () => {
    // Certains liens historiques peuvent porter des params vides — on doit
    // toujours considérer l'URL comme nue pour restaurer la trace.
    expect(isBlankProductsUrl(new URLSearchParams("q=&cat="))).toBe(true);
  });

  it("is false when the search query has a value", () => {
    expect(isBlankProductsUrl(new URLSearchParams("q=abc"))).toBe(false);
  });

  it("is false when a filter has a value even with tab=produits", () => {
    expect(isBlankProductsUrl(new URLSearchParams("tab=produits&important=1"))).toBe(false);
  });

  it("is false when tab is anything other than produits (user is on another library)", () => {
    // On ne restaure pas la trace si l'utilisatrice a explicitement choisi
    // une autre bibliothèque (catégories, couleurs, etc.).
    expect(isBlankProductsUrl(new URLSearchParams("tab=categories"))).toBe(false);
    expect(isBlankProductsUrl(new URLSearchParams("tab=couleurs"))).toBe(false);
  });

  it("is false when any product filter is active (cat, tag, status, etc.)", () => {
    for (const qs of ["cat=abc", "tag=x", "status=ONLINE", "important=1", "bestSeller=1"]) {
      expect(isBlankProductsUrl(new URLSearchParams(qs))).toBe(false);
    }
  });
});
