import { describe, it, expect } from "vitest";
import { normalizePrimaryFlag } from "@/lib/normalize-primary-flag";

describe("normalizePrimaryFlag", () => {
  it("retourne le tableau tel quel quand il est vide", () => {
    expect(normalizePrimaryFlag([])).toEqual([]);
  });

  it("force la première variante à primary quand aucune ne l'est", () => {
    const result = normalizePrimaryFlag([
      { isPrimary: false, id: "a" },
      { isPrimary: false, id: "b" },
      { isPrimary: false, id: "c" },
    ]);
    expect(result.map((c) => c.isPrimary)).toEqual([true, false, false]);
  });

  it("respecte la variante choisie quand exactement une est primary", () => {
    const result = normalizePrimaryFlag([
      { isPrimary: false, id: "a" },
      { isPrimary: false, id: "b" },
      { isPrimary: true,  id: "c" },
    ]);
    expect(result.map((c) => c.isPrimary)).toEqual([false, false, true]);
  });

  it("ne conserve qu'une seule primary (la dernière) quand plusieurs sont marquées", () => {
    const result = normalizePrimaryFlag([
      { isPrimary: true,  id: "a" },
      { isPrimary: false, id: "b" },
      { isPrimary: true,  id: "c" },
    ]);
    const primaries = result.filter((c) => c.isPrimary);
    expect(primaries).toHaveLength(1);
    // On garde la dernière marquée — c'est l'intention récente de l'utilisateur,
    // car le bug legacy forçait toujours la 1ʳᵉ à primary en plus du vrai choix
    expect(primaries[0].id).toBe("c");
  });

  it("préserve les autres champs des variantes", () => {
    const input = [
      { isPrimary: false, id: "a", unitPrice: 10, stock: 5 },
      { isPrimary: true,  id: "b", unitPrice: 20, stock: 3 },
    ];
    const result = normalizePrimaryFlag(input);
    expect(result[0]).toMatchObject({ id: "a", unitPrice: 10, stock: 5, isPrimary: false });
    expect(result[1]).toMatchObject({ id: "b", unitPrice: 20, stock: 3, isPrimary: true });
  });

  it("ne mute pas le tableau d'entrée", () => {
    const input = [
      { isPrimary: true,  id: "a" },
      { isPrimary: true,  id: "b" },
    ];
    const before = JSON.stringify(input);
    normalizePrimaryFlag(input);
    expect(JSON.stringify(input)).toBe(before);
  });
});
