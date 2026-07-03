import { describe, it, expect } from "vitest";
import {
  matchesSearch,
  matchesFilters,
  countMissing,
  type HsCodeForFilters,
} from "@/lib/hs-code-filters";

const code = (over: Partial<HsCodeForFilters> = {}): HsCodeForFilters => ({
  id: "c1",
  code: "7117190000",
  label: "Bijouterie fantaisie en métaux communs",
  productCount: 42,
  ...over,
});

describe("matchesSearch", () => {
  it("renvoie true si query vide", () => {
    expect(matchesSearch(code(), "")).toBe(true);
  });
  it("matche sur le numéro", () => {
    expect(matchesSearch(code(), "7117")).toBe(true);
  });
  it("matche sur le libellé, insensible à la casse", () => {
    expect(matchesSearch(code(), "bijouterie")).toBe(true);
  });
  it("ne matche pas si rien", () => {
    expect(matchesSearch(code({ label: "Sacs" }), "bijou")).toBe(false);
  });
});

describe("matchesFilters", () => {
  it("aucun filtre → toujours true", () => {
    expect(matchesFilters(code(), new Set())).toBe(true);
  });
  it("unused → code utilisé ne match pas", () => {
    expect(matchesFilters(code(), new Set(["unused"]))).toBe(false);
  });
  it("unused → productCount 0 → match", () => {
    expect(matchesFilters(code({ productCount: 0 }), new Set(["unused"]))).toBe(true);
  });
  it("lowUsage → 1 à 9 produits → match", () => {
    expect(matchesFilters(code({ productCount: 5 }), new Set(["lowUsage"]))).toBe(true);
  });
  it("lowUsage → 0 produit → ne match pas (inutilisé, pas peu utilisé)", () => {
    expect(matchesFilters(code({ productCount: 0 }), new Set(["lowUsage"]))).toBe(false);
  });
  it("lowUsage → 10 produits ou plus → ne match pas", () => {
    expect(matchesFilters(code({ productCount: 10 }), new Set(["lowUsage"]))).toBe(false);
    expect(matchesFilters(code({ productCount: 100 }), new Set(["lowUsage"]))).toBe(false);
  });
});

describe("countMissing", () => {
  it("compte les codes inutilisés", () => {
    const list = [
      code(),
      code({ id: "c2", productCount: 0 }),
      code({ id: "c3", productCount: 0 }),
    ];
    expect(countMissing(list, "unused")).toBe(2);
  });
  it("compte les codes peu utilisés (1..9)", () => {
    const list = [
      code(),
      code({ id: "c2", productCount: 0 }),
      code({ id: "c3", productCount: 3 }),
      code({ id: "c4", productCount: 9 }),
      code({ id: "c5", productCount: 10 }),
    ];
    expect(countMissing(list, "lowUsage")).toBe(2);
  });
});
