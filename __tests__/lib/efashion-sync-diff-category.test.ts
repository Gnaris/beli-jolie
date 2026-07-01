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

function snap(
  variants: EfashionVariantSnapshot[],
  categoryId: number | null,
): EfashionSnapshot {
  return {
    version: 1,
    referenceBase: "G297",
    variants,
    descriptions: { fr: "x", en: "x", it: "x", es: "x", zh: "x" },
    compositions: [],
    primaryEfashionProductId: variants[0]?.efashionProductId ?? null,
    categoryId,
  };
}

describe("diffEfashionSnapshots — catégorie", () => {
  it("ne signale rien si la catégorie est identique", () => {
    const before = snap([variant(111)], 160103); // Bracelets
    const after = snap([variant(111)], 160103);
    const diff = diffEfashionSnapshots(before, after);
    expect(diff.categoryChanged).toBe(false);
    expect(hasAnyChanges(diff)).toBe(false);
  });

  it("signale categoryChanged quand l'utilisatrice passe Bracelet → Chaîne de cheville", () => {
    const before = snap([variant(111)], 160103); // Bracelets
    const after = snap([variant(111)], 160108); // Chaînes de cheville
    const diff = diffEfashionSnapshots(before, after);
    expect(diff.categoryChanged).toBe(true);
    expect(hasAnyChanges(diff)).toBe(true);
  });

  it("signale categoryChanged si le snapshot legacy n'avait pas de categoryId", () => {
    const before: EfashionSnapshot = {
      version: 1,
      referenceBase: "G297",
      variants: [variant(111)],
      descriptions: { fr: "x", en: "x", it: "x", es: "x", zh: "x" },
      compositions: [],
      primaryEfashionProductId: 111,
      // categoryId absent = snapshot pré-2026-07-01
    };
    const after = snap([variant(111)], 160108);
    const diff = diffEfashionSnapshots(before, after);
    expect(diff.categoryChanged).toBe(true);
  });

  it("ne signale pas categoryChanged si la cible est null (pas de mapping BJ)", () => {
    const before = snap([variant(111)], 160103);
    const after: EfashionSnapshot = { ...before, categoryId: null };
    const diff = diffEfashionSnapshots(before, after);
    expect(diff.categoryChanged).toBe(false);
  });

  it("signale categoryChanged sur snapshot initial (before=null) si la cible est définie", () => {
    const after = snap([variant(111)], 160108);
    const diff = diffEfashionSnapshots(null, after);
    expect(diff.categoryChanged).toBe(true);
  });
});
