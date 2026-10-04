import { describe, it, expect } from "vitest";
import {
  buildPriceFilterHref,
  normalizePriceInput,
} from "@/components/issyma/price-filter-url";

describe("normalizePriceInput", () => {
  it("convertit la virgule française en point décimal", () => {
    expect(normalizePriceInput("12,5")).toBe("12.5");
  });

  it("retire les espaces en début et fin", () => {
    expect(normalizePriceInput("  30  ")).toBe("30");
  });

  it("renvoie une chaîne vide si input vide", () => {
    expect(normalizePriceInput("")).toBe("");
    expect(normalizePriceInput("   ")).toBe("");
  });
});

describe("buildPriceFilterHref — URL du filtre fourchette de prix Issyma", () => {
  it("pose minPrice et maxPrice sans écraser les filtres existants", () => {
    const href = buildPriceFilterHref(
      { cat: "cat-1", color: "red" },
      "10",
      "50",
    );
    const params = new URLSearchParams(href.split("?")[1]);
    expect(params.get("cat")).toBe("cat-1");
    expect(params.get("color")).toBe("red");
    expect(params.get("minPrice")).toBe("10");
    expect(params.get("maxPrice")).toBe("50");
  });

  it("accepte min seul (max vide) et inversement", () => {
    expect(buildPriceFilterHref({}, "10", "")).toBe("/produits?minPrice=10");
    expect(buildPriceFilterHref({}, "", "50")).toBe("/produits?maxPrice=50");
  });

  it("efface les bornes quand min et max sont vides", () => {
    const href = buildPriceFilterHref({ cat: "cat-1" }, "", "");
    expect(href).toBe("/produits?cat=cat-1");
  });

  it("retourne /produits nu si aucun filtre à préserver et pas de bornes", () => {
    expect(buildPriceFilterHref({}, "", "")).toBe("/produits");
  });

  it("ignore les params préservés dont la valeur est undefined ou vide", () => {
    const href = buildPriceFilterHref(
      { cat: "cat-1", color: undefined, tag: "" },
      "10",
      "",
    );
    const params = new URLSearchParams(href.split("?")[1]);
    expect(params.get("cat")).toBe("cat-1");
    expect(params.has("color")).toBe(false);
    expect(params.has("tag")).toBe(false);
    expect(params.get("minPrice")).toBe("10");
  });
});
