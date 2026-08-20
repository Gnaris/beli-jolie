import { describe, expect, it } from "vitest";
import {
  buildAnkorstoreBoSku,
  normalizeColorForSku,
  normalizeReferenceForSku,
  generateAnkorstoreBoSkuSuffix,
  MAX_SKU_LENGTH,
  SKU_SUFFIX_LENGTH,
} from "@/lib/ankorstore-bo/sku";

describe("normalizeColorForSku", () => {
  it("garde une couleur simple en majuscules", () => {
    expect(normalizeColorForSku("Rouge")).toBe("ROUGE");
    expect(normalizeColorForSku("BLEU")).toBe("BLEU");
  });

  it("retire les accents", () => {
    expect(normalizeColorForSku("Doré")).toBe("DORE");
    expect(normalizeColorForSku("Écru")).toBe("ECRU");
    expect(normalizeColorForSku("Œillet")).toBe("OEILLET");
  });

  it("gère les apostrophes (cas 'Vert D'eau')", () => {
    expect(normalizeColorForSku("Vert D'eau")).toBe("VERT_DEAU");
    expect(normalizeColorForSku("Vert d'eau")).toBe("VERT_DEAU");
    expect(normalizeColorForSku("Vert D’eau")).toBe("VERT_DEAU");
  });

  it("gère les séparateurs multi-mots (cas 'Multicolore - Bleu')", () => {
    expect(normalizeColorForSku("Multicolore - Bleu")).toBe("MULTICOLORE_BLEU");
    expect(normalizeColorForSku("Multicolore-Bleu")).toBe("MULTICOLORE_BLEU");
    expect(normalizeColorForSku("Multicolore/Bleu")).toBe("MULTICOLORE_BLEU");
    expect(normalizeColorForSku("Multicolore & Bleu")).toBe("MULTICOLORE_BLEU");
  });

  it("compresse les underscores répétés", () => {
    expect(normalizeColorForSku("A   B    C")).toBe("A_B_C");
    expect(normalizeColorForSku("A - - B")).toBe("A_B");
  });

  it("retire les caractères ponctuation", () => {
    expect(normalizeColorForSku("Bleu, Rouge.")).toBe("BLEU_ROUGE");
    expect(normalizeColorForSku('"Bleu"')).toBe("BLEU");
  });

  it("fournit un fallback si couleur totalement exotique", () => {
    expect(normalizeColorForSku("!!!")).toBe("");
  });
});

describe("normalizeReferenceForSku", () => {
  it("uppercase et retire tout non alphanumérique", () => {
    expect(normalizeReferenceForSku("a1555")).toBe("A1555");
    expect(normalizeReferenceForSku("ZC-1234")).toBe("ZC1234");
    expect(normalizeReferenceForSku("A 1555 ")).toBe("A1555");
  });
});

describe("generateAnkorstoreBoSkuSuffix", () => {
  it(`renvoie ${SKU_SUFFIX_LENGTH} caractères dans l'alphabet safe`, () => {
    for (let i = 0; i < 100; i++) {
      const s = generateAnkorstoreBoSkuSuffix();
      expect(s).toHaveLength(SKU_SUFFIX_LENGTH);
      // Alphabet sans O/0/I/1/L
      expect(s).toMatch(/^[ABCDEFGHJKMNPQRSTUVWXYZ23456789]+$/);
    }
  });

  it("ne produit pas de doublon massif sur 1000 tirages", () => {
    const set = new Set<string>();
    for (let i = 0; i < 1000; i++) set.add(generateAnkorstoreBoSkuSuffix());
    // 1000 tirages sur ~28M combinaisons — collision quasi impossible.
    // On tolère 1 collision au cas où (test flaky à zéro tolérance sinon).
    expect(set.size).toBeGreaterThanOrEqual(999);
  });
});

describe("buildAnkorstoreBoSku (nouveau format {REF}_{COULEUR}_{5chars})", () => {
  it("cas nominal — cliente : A1555 + Vert D'eau", () => {
    const sku = buildAnkorstoreBoSku("A1555", "Vert D'eau");
    expect(sku).toMatch(/^A1555_VERT_DEAU_[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{5}$/);
  });

  it("cas nominal — cliente : A1555 + Multicolore - Bleu", () => {
    const sku = buildAnkorstoreBoSku("A1555", "Multicolore - Bleu");
    expect(sku).toMatch(/^A1555_MULTICOLORE_BLEU_[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{5}$/);
  });

  it("supporte les couleurs simples", () => {
    expect(buildAnkorstoreBoSku("A1555", "Doré")).toMatch(/^A1555_DORE_.{5}$/);
    expect(buildAnkorstoreBoSku("A1555", "Argent")).toMatch(/^A1555_ARGENT_.{5}$/);
    expect(buildAnkorstoreBoSku("A1555", "Rouge")).toMatch(/^A1555_ROUGE_.{5}$/);
  });

  it("fallback quand couleur normalisée est vide", () => {
    expect(buildAnkorstoreBoSku("A1555", "")).toMatch(/^A1555_COULEUR_.{5}$/);
    expect(buildAnkorstoreBoSku("A1555", "!!!")).toMatch(/^A1555_COULEUR_.{5}$/);
  });

  it("tronque la couleur si dépasse MAX_SKU_LENGTH mais garde le suffixe intact", () => {
    const longColor = "Vert Bleu Rouge Multicolore Special Edition Limited";
    const sku = buildAnkorstoreBoSku("A1555", longColor);
    expect(sku.length).toBeLessThanOrEqual(MAX_SKU_LENGTH);
    expect(sku.startsWith("A1555_")).toBe(true);
    expect(sku).not.toMatch(/_$/);
    // Le suffixe (les 5 derniers chars alphanum de l'alphabet safe) doit être intact
    expect(sku).toMatch(/_[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{5}$/);
  });

  it("throw si la référence est vide après normalisation", () => {
    expect(() => buildAnkorstoreBoSku("", "Rouge")).toThrow(/référence vide/i);
    expect(() => buildAnkorstoreBoSku("!!!", "Rouge")).toThrow(/référence vide/i);
  });

  it("réutilise un suffixe existant si fourni (mode update)", () => {
    const sku = buildAnkorstoreBoSku("A1720", "Rouge", "ABCDE");
    expect(sku).toBe("A1720_ROUGE_ABCDE");
  });

  it("génère un nouveau suffixe si `existingSuffix` invalide (mauvaise longueur)", () => {
    // Suffixe trop court → ignoré, on regénère un neuf.
    const sku = buildAnkorstoreBoSku("A1720", "Rouge", "AB");
    expect(sku).toMatch(/^A1720_ROUGE_.{5}$/);
    expect(sku).not.toContain("_AB");
  });

  it("2 appels sans suffixe donnent des SKU différents (unicité par appel)", () => {
    const a = buildAnkorstoreBoSku("A1720", "Rouge");
    const b = buildAnkorstoreBoSku("A1720", "Rouge");
    expect(a).not.toBe(b);
  });

  it("respecte l'exemple étendu de la cliente pour une ref complexe", () => {
    expect(buildAnkorstoreBoSku("ZC1234", "Vert D'eau clair")).toMatch(
      /^ZC1234_VERT_DEAU_CLAIR_.{5}$/
    );
    expect(buildAnkorstoreBoSku("A1720", "Bleu / Vert")).toMatch(/^A1720_BLEU_VERT_.{5}$/);
  });

  it("cas rename référence — le suffixe existant est réutilisé avec la nouvelle référence", () => {
    // Cliente renomme A1720 → A1721 : le suffixe aléatoire persisté en BDD est
    // extrait par le resolver et repassé ici. Le SKU envoyé au PUT Ankor porte
    // la nouvelle ref mais reste stable côté suffixe (aucune collision).
    const oldSku = "A1720_ROUGE_ABCDE";
    const suffix = oldSku.split("_").pop()!;
    const newSku = buildAnkorstoreBoSku("A1721", "Rouge", suffix);
    expect(newSku).toBe("A1721_ROUGE_ABCDE");
  });
});

