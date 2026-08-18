import { describe, it, expect } from "vitest";

import {
  diffEfashionSnapshots,
  hasAnyChanges,
  type EfashionSnapshot,
  type EfashionVariantSnapshot,
} from "@/lib/efashion-sync-diff";

function variant(
  efashionProductId: number,
  overrides: Partial<EfashionVariantSnapshot> = {},
): EfashionVariantSnapshot {
  return {
    efashionProductId,
    visible: true,
    prix: 10,
    poids: 0.05,
    stockByTaille: { TU: 5 },
    images: [],
    ...overrides,
  };
}

function snap(referenceBase: string, variants: EfashionVariantSnapshot[]): EfashionSnapshot {
  return {
    version: 1,
    referenceBase,
    variants,
    descriptions: { fr: "x", en: "x", it: "x", es: "x", zh: "x" },
    compositions: [],
    primaryEfashionProductId: variants[0]?.efashionProductId ?? null,
    categoryId: 160103,
  };
}

describe("diffEfashionSnapshots — referenceBase", () => {
  it("ne signale rien si la référence n'a pas changé", () => {
    const before = snap("A1720", [variant(111)]);
    const after = snap("A1720", [variant(111)]);
    const diff = diffEfashionSnapshots(before, after);
    expect(diff.referenceBaseChanged).toBe(false);
    expect(hasAnyChanges(diff)).toBe(false);
  });

  it("signale referenceBaseChanged quand l'admin renomme la référence BJ", () => {
    const before = snap("A1720", [variant(111), variant(222)]);
    const after = snap("A1721", [variant(111), variant(222)]);
    const diff = diffEfashionSnapshots(before, after);
    expect(diff.referenceBaseChanged).toBe(true);
    expect(hasAnyChanges(diff)).toBe(true);
  });

  it("hasAnyChanges reste vrai même si SEULE la référence a changé", () => {
    const before = snap("A1720", [variant(111)]);
    const after = snap("A1721", [variant(111)]);
    const diff = diffEfashionSnapshots(before, after);
    expect(diff.changed).toHaveLength(0);
    expect(diff.added).toHaveLength(0);
    expect(diff.removed).toHaveLength(0);
    expect(hasAnyChanges(diff)).toBe(true);
  });

  it("ne signale pas referenceBaseChanged sur snapshot initial (before=null)", () => {
    const after = snap("A1720", [variant(111)]);
    const diff = diffEfashionSnapshots(null, after);
    expect(diff.referenceBaseChanged).toBe(false);
  });
});
