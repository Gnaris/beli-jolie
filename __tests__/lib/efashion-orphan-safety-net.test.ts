import { describe, it, expect } from "vitest";
import { computeOrphanEfashionIds } from "@/lib/efashion-update";

// Scénario réel reproduit : produit 92952 (tenant issyma), couleur Écru
// (efId=3771756) désactivée localement (disabled=true) → BJ pousse
// `visible=false` à eFashion → eFashion cache Écru de son listing groupe
// (même avec premelFilter="tous", eFashion filtre par visible=true).
// En mode Rafraîchir (forceFullSync=true), le diff met TOUTES les
// variantes dans `added` — le filet naïf marquerait à tort Écru comme
// « inconnue d'eFashion ». Cette fonction corrige le faux positif en
// filtrant les variantes déjà présentes dans le snapshot RÉEL.

const v = (id: number) => ({ efashionProductId: id });

describe("computeOrphanEfashionIds", () => {
  it("marque comme orpheline une VRAIE nouvelle variante absente d'eFashion", () => {
    const added = [v(3771753), v(3771754), v(9999999)]; // 9999999 = nouveau, pas sur eFashion
    const live = new Set([3771753, 3771754]);
    const prev = [{ efashionProductId: 3771753 }, { efashionProductId: 3771754 }];
    const orphans = computeOrphanEfashionIds(added, live, prev);
    expect(Array.from(orphans)).toEqual([9999999]);
  });

  it("NE marque PAS comme orpheline une variante ANCIENNE cachée par visible=false (cas Écru 92952)", () => {
    // Reproduction du bug 26/07/2026 : forceFullSync=true → 8 variantes dans `added`,
    // Écru (3771756) absente du listing car BJ a poussé visible=false le 24/07.
    // Snapshot précédent connaît bien les 8 variantes.
    const added = [
      v(3771753), v(3771754), v(3771755), v(3771756),
      v(3771757), v(3771758), v(3771759), v(3771760),
    ];
    const live = new Set([3771753, 3771754, 3771755, 3771757, 3771758, 3771759, 3771760]); // 3771756 absente
    const prev = [
      v(3771753), v(3771754), v(3771755), v(3771756),
      v(3771757), v(3771758), v(3771759), v(3771760),
    ];
    const orphans = computeOrphanEfashionIds(added, live, prev);
    expect(orphans.size).toBe(0);
  });

  it("distingue orpheline VRAIE (jamais dans prev) et absente légitime (dans prev mais cachée)", () => {
    // added contient : 1 ancienne cachée + 1 vraiment nouvelle orpheline
    const added = [v(100), v(200), v(999)];
    const live = new Set([100]); // 200 cachée par visible=false, 999 vraiment orpheline
    const prev = [v(100), v(200)]; // 200 était déjà là (avant qu'on la cache)
    const orphans = computeOrphanEfashionIds(added, live, prev);
    expect(Array.from(orphans)).toEqual([999]);
  });

  it("snapshot précédent null (1ʳᵉ sync) : toutes les variantes absentes du listing sont orphelines", () => {
    const added = [v(100), v(200)];
    const live = new Set([100]);
    const orphans = computeOrphanEfashionIds(added, live, null);
    expect(Array.from(orphans)).toEqual([200]);
  });

  it("aucune variante dans added → jeu vide", () => {
    const orphans = computeOrphanEfashionIds([], new Set([1, 2]), [{ efashionProductId: 1 }]);
    expect(orphans.size).toBe(0);
  });

  it("toutes les variantes présentes dans live → aucune orpheline", () => {
    const added = [v(1), v(2), v(3)];
    const live = new Set([1, 2, 3]);
    const orphans = computeOrphanEfashionIds(added, live, null);
    expect(orphans.size).toBe(0);
  });
});
