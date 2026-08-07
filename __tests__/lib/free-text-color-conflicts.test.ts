/**
 * Tests du helper de détection de conflits de nom couleur pour Ankor/Faire.
 */
import { describe, it, expect } from "vitest";
import {
  effectiveFreeTextName,
  detectFreeTextColorConflicts,
} from "@/lib/free-text-color-conflicts";

describe("effectiveFreeTextName", () => {
  it("retourne le nom BJ si pas d'override", () => {
    expect(effectiveFreeTextName({ colorName: "Doré", overrideName: null })).toBe("Doré");
  });

  it("retourne l'override si renseigné", () => {
    expect(effectiveFreeTextName({ colorName: "Doré", overrideName: "Or rose" })).toBe("Or rose");
  });

  it("considère override vide/whitespace comme absent", () => {
    expect(effectiveFreeTextName({ colorName: "Doré", overrideName: "" })).toBe("Doré");
    expect(effectiveFreeTextName({ colorName: "Doré", overrideName: "   " })).toBe("Doré");
  });

  it("retourne null si ni override ni nom BJ", () => {
    expect(effectiveFreeTextName({ colorName: "", overrideName: null })).toBeNull();
  });
});

describe("detectFreeTextColorConflicts", () => {
  it("aucun conflit avec 2 couleurs distinctes et différentes", () => {
    const result = detectFreeTextColorConflicts([
      { key: "c1", colorId: "id-1", colorName: "Doré", overrideName: null },
      { key: "c2", colorId: "id-2", colorName: "Argenté", overrideName: null },
    ]);
    expect(result).toEqual([]);
  });

  it("détecte 2 couleurs avec le même nom BJ (sans override)", () => {
    const result = detectFreeTextColorConflicts([
      { key: "c1", colorId: "id-1", colorName: "Doré", overrideName: null },
      { key: "c2", colorId: "id-2", colorName: "Doré", overrideName: null },
    ]);
    expect(result).toHaveLength(1);
    expect(result[0]!.entries).toHaveLength(2);
  });

  it("case-insensitive : Doré === DORÉ === doRÉ", () => {
    const result = detectFreeTextColorConflicts([
      { key: "c1", colorId: "id-1", colorName: "Doré", overrideName: null },
      { key: "c2", colorId: "id-2", colorName: "Argenté", overrideName: "DORÉ" },
      { key: "c3", colorId: "id-3", colorName: "Bronze", overrideName: "doRÉ" },
    ]);
    expect(result).toHaveLength(1);
    expect(result[0]!.entries).toHaveLength(3);
  });

  it("override qui collisionne avec le nom BJ d'une autre couleur = conflit", () => {
    const result = detectFreeTextColorConflicts([
      { key: "c1", colorId: "id-1", colorName: "Doré", overrideName: null },
      { key: "c2", colorId: "id-2", colorName: "Bronze", overrideName: "Doré" },
    ]);
    expect(result).toHaveLength(1);
    expect(result[0]!.normalizedName).toBe("doré");
  });

  it("pas de conflit si 2 entrées pointent sur la même couleur BJ (même colorId)", () => {
    const result = detectFreeTextColorConflicts([
      { key: "v1", colorId: "id-1", colorName: "Doré", overrideName: null },
      { key: "v2", colorId: "id-1", colorName: "Doré", overrideName: null },
    ]);
    expect(result).toEqual([]);
  });

  it("ignore les espaces de début/fin", () => {
    const result = detectFreeTextColorConflicts([
      { key: "c1", colorId: "id-1", colorName: "Doré", overrideName: null },
      { key: "c2", colorId: "id-2", colorName: "Bronze", overrideName: "  Doré  " },
    ]);
    expect(result).toHaveLength(1);
  });

  it("plusieurs conflits distincts sont retournés séparément", () => {
    const result = detectFreeTextColorConflicts([
      { key: "c1", colorId: "id-1", colorName: "Doré", overrideName: null },
      { key: "c2", colorId: "id-2", colorName: "doré", overrideName: null },
      { key: "c3", colorId: "id-3", colorName: "Argenté", overrideName: null },
      { key: "c4", colorId: "id-4", colorName: "ARGENTÉ", overrideName: null },
    ]);
    expect(result).toHaveLength(2);
  });

  it("entrées sans nom ni override sont ignorées", () => {
    const result = detectFreeTextColorConflicts([
      { key: "c1", colorId: "id-1", colorName: "", overrideName: null },
      { key: "c2", colorId: "id-2", colorName: "", overrideName: null },
    ]);
    expect(result).toEqual([]);
  });
});
