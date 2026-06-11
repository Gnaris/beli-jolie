import { describe, it, expect } from "vitest";
import { planShiftCascade } from "@/lib/import-processor";

describe("planShiftCascade", () => {
  it("ne planifie aucun déplacement si la position cible est libre", () => {
    expect(planShiftCascade(0, new Set())).toEqual([]);
    expect(planShiftCascade(2, new Set([0, 1]))).toEqual([]);
  });

  it("décale la seule image existante d'un cran quand la suivante est libre", () => {
    // Image à 0, on veut insérer à 0 → l'image à 0 part à 1
    expect(planShiftCascade(0, new Set([0]))).toEqual([{ from: 0, to: 1 }]);
  });

  it("décale en cascade un bloc contigu et retourne les moves du plus haut au plus bas", () => {
    // {0, 1, 2}, cible 0 → 2→3, 1→2, 0→1 (appliqué dans cet ordre pour éviter les collisions)
    expect(planShiftCascade(0, new Set([0, 1, 2]))).toEqual([
      { from: 2, to: 3 },
      { from: 1, to: 2 },
      { from: 0, to: 1 },
    ]);
  });

  it("ne décale que la portion contiguë depuis la cible (s'arrête au premier trou)", () => {
    // {0, 1, 3}, cible 0 → bloc contigu = {0, 1} (3 reste en place)
    expect(planShiftCascade(0, new Set([0, 1, 3]))).toEqual([
      { from: 1, to: 2 },
      { from: 0, to: 1 },
    ]);
  });

  it("fonctionne quand la cible est au milieu (3 occupé, 4 libre)", () => {
    // {3, 5}, cible 3 → seul 3 est contigu (4 libre) → 3 → 4
    expect(planShiftCascade(3, new Set([3, 5]))).toEqual([
      { from: 3, to: 4 },
    ]);
  });

  it("gère un bloc de 4 images contiguës", () => {
    // {0, 1, 2, 3}, cible 1 → bloc {1,2,3} → 3→4, 2→3, 1→2
    expect(planShiftCascade(1, new Set([0, 1, 2, 3]))).toEqual([
      { from: 3, to: 4 },
      { from: 2, to: 3 },
      { from: 1, to: 2 },
    ]);
  });

  it("garantit qu'aucune destination n'est déjà occupée après application (preuve d'absence de collision)", () => {
    // Pour {0, 1, 2} cible 0 : on applique les moves dans l'ordre et on vérifie qu'aucun
    // ne tape sur une order déjà existante au moment de l'application.
    const used = new Set([0, 1, 2]);
    const moves = planShiftCascade(0, used);
    const live = new Set(used);
    for (const move of moves) {
      expect(live.has(move.to)).toBe(false); // destination libre
      live.delete(move.from);
      live.add(move.to);
    }
    // À la fin, la position 0 doit être libre pour l'insertion
    expect(live.has(0)).toBe(false);
  });
});
