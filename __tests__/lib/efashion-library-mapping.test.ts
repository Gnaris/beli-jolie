import { describe, it, expect } from "vitest";
import {
  findEfashionMapping,
  normalizeLibraryName,
  EFASHION_CATEGORY_MAPPING,
  EFASHION_COMPOSITION_MAPPING,
  EFASHION_COLOR_MAPPING,
  EFASHION_SEASON_MAPPING,
} from "@/lib/efashion-library-mapping";

describe("normalizeLibraryName", () => {
  it("strips accents, lowercases and trims", () => {
    expect(normalizeLibraryName("Doré")).toBe("dore");
    expect(normalizeLibraryName("  ÉCRU  ")).toBe("ecru");
    expect(normalizeLibraryName("Chaînes de cheville")).toBe("chaines de cheville");
  });
});

describe("findEfashionMapping", () => {
  it("returns null when nothing matches", () => {
    expect(findEfashionMapping("nimportequoi", EFASHION_CATEGORY_MAPPING)).toBeNull();
  });

  it("matches exact name", () => {
    const m = findEfashionMapping("Bagues", EFASHION_CATEGORY_MAPPING);
    expect(m?.efashionId).toBe(160101);
  });

  it("matches case-insensitively", () => {
    expect(findEfashionMapping("BAGUES", EFASHION_CATEGORY_MAPPING)?.efashionId).toBe(160101);
    expect(findEfashionMapping("bagues", EFASHION_CATEGORY_MAPPING)?.efashionId).toBe(160101);
  });

  it("matches accent-insensitively", () => {
    expect(
      findEfashionMapping("Chaines de cheville", EFASHION_CATEGORY_MAPPING)?.efashionId,
    ).toBe(160108);
    expect(findEfashionMapping("Doré", EFASHION_COLOR_MAPPING)?.efashionId).toBe(78);
  });
});

describe("EFASHION_CATEGORY_MAPPING", () => {
  it("maps every jewelry category under Accessoires > Bijoux", () => {
    const jewelryNames = [
      "Bagues",
      "Boucles d'oreilles",
      "Bracelets",
      "Broches",
      "Chaînes de cheville",
      "Colliers",
      "Parures de bijoux",
      "Pendentifs",
      "Piercings",
      "Porte-clés",
    ];
    for (const n of jewelryNames) {
      const m = findEfashionMapping(n, EFASHION_CATEGORY_MAPPING);
      expect(m, `missing: ${n}`).not.toBeNull();
      // Tous les IDs Accessoires>Bijoux commencent par 1601
      expect(String(m!.efashionId).startsWith("1601"), `${n} not under Bijoux`).toBe(true);
    }
  });

  it("routes presentation / bag / box categories to Accessoires > Autres > Présentoir (160412)", () => {
    const presentoirNames = [
      "Lots avec présentoir",
      "Présentoirs et rangements nus",
      "Sacs",
      "Boîtes & Pochettes",
    ];
    for (const n of presentoirNames) {
      expect(findEfashionMapping(n, EFASHION_CATEGORY_MAPPING)?.efashionId).toBe(160412);
    }
  });

  it("routes Lunettes to Accessoires > Autres > Lunettes (160402)", () => {
    expect(findEfashionMapping("Lunettes", EFASHION_CATEGORY_MAPPING)?.efashionId).toBe(160402);
  });

  it("does not contain any clothing category (those should stay unmapped)", () => {
    const clothing = [
      "Blouses",
      "Chemises",
      "Robes",
      "Vestes",
      "T-Shirts",
      "Pulls",
      "Jupes",
    ];
    for (const n of clothing) {
      expect(findEfashionMapping(n, EFASHION_CATEGORY_MAPPING)).toBeNull();
    }
  });

  it("picks 160111 (not 160106) for Broches", () => {
    expect(findEfashionMapping("Broches", EFASHION_CATEGORY_MAPPING)?.efashionId).toBe(160111);
  });
});

describe("EFASHION_COMPOSITION_MAPPING", () => {
  it("maps both Acier and Acier inoxydable to Inox (182)", () => {
    expect(findEfashionMapping("Acier", EFASHION_COMPOSITION_MAPPING)?.efashionId).toBe(182);
    expect(findEfashionMapping("Acier inoxydable", EFASHION_COMPOSITION_MAPPING)?.efashionId).toBe(
      182,
    );
  });

  it("maps Laiton to Métal (47) since eFashion has no Laiton", () => {
    expect(findEfashionMapping("Laiton", EFASHION_COMPOSITION_MAPPING)?.efashionId).toBe(47);
  });

  it("covers all 9 BJ materials", () => {
    const names = ["Acier", "Acier inoxydable", "Bois", "Laiton", "Métal", "Pierre", "Plastique", "Résine", "Tissu"];
    for (const n of names) {
      expect(findEfashionMapping(n, EFASHION_COMPOSITION_MAPPING), `missing: ${n}`).not.toBeNull();
    }
  });
});

describe("EFASHION_SEASON_MAPPING", () => {
  it("maps Printemps/Été 2026 → 3 (Toutes les saisons)", () => {
    expect(findEfashionMapping("Printemps/Été 2026", EFASHION_SEASON_MAPPING)?.efashionId).toBe(3);
  });
});

describe("EFASHION_COLOR_MAPPING", () => {
  it("covers all 42 BJ colors", () => {
    const names = [
      "Argent", "Beige", "Bicolore", "Blanc", "Bleu", "Bleu Ciel", "Bleu Clair",
      "Bleu Foncé", "Bordeaux", "Brun", "Brun foncé", "Corail", "Cyan", "Doré",
      "Écru", "Fuchsia", "Gris", "Gris Clair", "Gris Foncé", "Gris Perle",
      "Gris Souris", "Ivoire", "Jaune", "Kaki", "Léopard", "Marine", "Marron",
      "Marron Clair", "Marron Foncé", "Moutarde", "Multicolore", "Noir", "Orange",
      "Rose", "Rose Fluo", "Rouge", "Rouge Foncé", "Transparent", "Turquoise",
      "Vert", "Vert Foncé", "Violet",
    ];
    expect(names).toHaveLength(42);
    for (const n of names) {
      const m = findEfashionMapping(n, EFASHION_COLOR_MAPPING);
      expect(m, `missing: ${n}`).not.toBeNull();
    }
  });

  it("flags the 8 colors that require addCouleurToVendeur", () => {
    const needAdd = EFASHION_COLOR_MAPPING.filter((c) => c.needsVendorAdd).map((c) => c.name);
    expect(needAdd.sort()).toEqual(
      [
        "Bleu Clair",
        "Brun foncé",
        "Cyan",
        "Gris Perle",
        "Gris Souris",
        "Ivoire",
        "Marron Clair",
        "Marron Foncé",
      ].sort(),
    );
  });

  it("does not assign the same efashionId twice", () => {
    const ids = EFASHION_COLOR_MAPPING.map((c) => c.efashionId);
    expect(new Set(ids).size).toBe(ids.length);
  });
});
