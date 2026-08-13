import { describe, expect, it } from "vitest";
import {
  buildAnkorstoreBoSku,
  normalizeColorForSku,
  normalizeReferenceForSku,
  MAX_SKU_LENGTH,
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
    // Apostrophe courbe unicode ’
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
    // La normalisation elle-même renvoie "" — c'est buildAnkorstoreBoSku qui fait le fallback
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

describe("buildAnkorstoreBoSku", () => {
  it("cas nominal — cliente : A1555 + Vert D'eau", () => {
    expect(buildAnkorstoreBoSku("A1555", "Vert D'eau")).toBe("A1555_VERT_DEAU");
  });

  it("cas nominal — cliente : A1555 + Multicolore - Bleu", () => {
    expect(buildAnkorstoreBoSku("A1555", "Multicolore - Bleu")).toBe("A1555_MULTICOLORE_BLEU");
  });

  it("supporte les couleurs simples", () => {
    expect(buildAnkorstoreBoSku("A1555", "Doré")).toBe("A1555_DORE");
    expect(buildAnkorstoreBoSku("A1555", "Argent")).toBe("A1555_ARGENT");
    expect(buildAnkorstoreBoSku("A1555", "Rouge")).toBe("A1555_ROUGE");
  });

  it("fallback quand couleur normalisée est vide", () => {
    expect(buildAnkorstoreBoSku("A1555", "")).toBe("A1555_COULEUR");
    expect(buildAnkorstoreBoSku("A1555", "!!!")).toBe("A1555_COULEUR");
  });

  it("tronque la couleur si dépasse MAX_SKU_LENGTH", () => {
    const longColor = "Vert Bleu Rouge Multicolore Special Edition Limited";
    const sku = buildAnkorstoreBoSku("A1555", longColor);
    expect(sku.length).toBeLessThanOrEqual(MAX_SKU_LENGTH);
    expect(sku.startsWith("A1555_")).toBe(true);
    expect(sku).not.toMatch(/_$/); // ne finit pas par _
  });

  it("throw si la référence est vide après normalisation", () => {
    expect(() => buildAnkorstoreBoSku("", "Rouge")).toThrow(/référence vide/i);
    expect(() => buildAnkorstoreBoSku("!!!", "Rouge")).toThrow(/référence vide/i);
  });

  it("respecte l'exemple étendu de la cliente pour une ref complexe", () => {
    // Vérifie que les cas variés dérivés des références BJ marchent
    expect(buildAnkorstoreBoSku("ZC1234", "Vert D'eau clair")).toBe("ZC1234_VERT_DEAU_CLAIR");
    expect(buildAnkorstoreBoSku("A1720", "Bleu / Vert")).toBe("A1720_BLEU_VERT");
  });
});
