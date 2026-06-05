import { describe, it, expect } from "vitest";
import { compactImageOrder } from "@/lib/import-processor";

describe("compactImageOrder", () => {
  it("garde la position originale si elle est libre et aucune plus basse libre", () => {
    expect(compactImageOrder(2, new Set([0, 1]), false)).toBe(2);
  });

  it("glisse vers la position 0 si elle est libre (cas demandé : pos 2 → pos 1 quand pos 1 vide)", () => {
    expect(compactImageOrder(1, new Set(), false)).toBe(0);
  });

  it("glisse vers la première position libre la plus basse", () => {
    expect(compactImageOrder(4, new Set([0, 1]), false)).toBe(2);
    expect(compactImageOrder(4, new Set([0, 2]), false)).toBe(1);
  });

  it("respecte la position originale si toutes les positions ≤ originale sont occupées", () => {
    expect(compactImageOrder(2, new Set([0, 1, 2]), false)).toBe(2);
  });

  it("respecte la position originale quand l'utilisatrice a explicitement choisi en preview (override)", () => {
    expect(compactImageOrder(3, new Set(), true)).toBe(3);
    expect(compactImageOrder(2, new Set([0]), true)).toBe(2);
  });

  it("garde la position 0 si elle est libre et que c'est la position originale", () => {
    expect(compactImageOrder(0, new Set(), false)).toBe(0);
  });

  it("retourne la position originale si elle est déjà occupée et qu'aucune plus basse n'est libre", () => {
    expect(compactImageOrder(1, new Set([0, 1]), false)).toBe(1);
  });
});
