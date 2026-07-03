import { describe, it, expect } from "vitest";
import {
  matchesSearch,
  matchesFilters,
  countMissing,
  type SizeForFilters,
} from "@/lib/size-filters";

const size = (over: Partial<SizeForFilters> = {}): SizeForFilters => ({
  id: "s1",
  name: "M",
  pfsSizeRef: "M",
  variantCount: 4,
  ...over,
});

describe("matchesSearch", () => {
  it("renvoie true si query vide", () => {
    expect(matchesSearch(size(), "")).toBe(true);
  });
  it("matche sur le nom, insensible à la casse", () => {
    expect(matchesSearch(size({ name: "XL" }), "xl")).toBe(true);
  });
  it("matche sur la référence PFS", () => {
    expect(matchesSearch(size({ pfsSizeRef: "Small" }), "small")).toBe(true);
  });
  it("ne matche pas si rien", () => {
    expect(matchesSearch(size({ name: "42", pfsSizeRef: "42" }), "L")).toBe(false);
  });
});

describe("matchesFilters", () => {
  it("aucun filtre actif → toujours true", () => {
    expect(matchesFilters(size(), new Set())).toBe(true);
  });
  it("missingPfs → taille mappée ne match pas", () => {
    expect(matchesFilters(size(), new Set(["missingPfs"]))).toBe(false);
  });
  it("missingPfs → pfsSizeRef null → match", () => {
    expect(matchesFilters(size({ pfsSizeRef: null }), new Set(["missingPfs"]))).toBe(true);
  });
  it("missingPfs → pfsSizeRef chaîne vide → match", () => {
    expect(matchesFilters(size({ pfsSizeRef: "" }), new Set(["missingPfs"]))).toBe(true);
  });
  it("unused → taille utilisée ne match pas", () => {
    expect(matchesFilters(size(), new Set(["unused"]))).toBe(false);
  });
  it("unused → variantCount 0 → match", () => {
    expect(matchesFilters(size({ variantCount: 0 }), new Set(["unused"]))).toBe(true);
  });
  it("filtres cumulés (ET logique)", () => {
    const s = size({ pfsSizeRef: null, variantCount: 0 });
    expect(matchesFilters(s, new Set(["missingPfs", "unused"]))).toBe(true);
    const s2 = size({ pfsSizeRef: null, variantCount: 3 });
    expect(matchesFilters(s2, new Set(["missingPfs", "unused"]))).toBe(false);
  });
});

describe("countMissing", () => {
  it("compte les tailles sans PFS", () => {
    const list = [size(), size({ id: "s2", pfsSizeRef: null }), size({ id: "s3", pfsSizeRef: "" })];
    expect(countMissing(list, "missingPfs")).toBe(2);
  });
  it("compte les tailles inutilisées", () => {
    const list = [size(), size({ id: "s2", variantCount: 0 }), size({ id: "s3", variantCount: 0 })];
    expect(countMissing(list, "unused")).toBe(2);
  });
});
