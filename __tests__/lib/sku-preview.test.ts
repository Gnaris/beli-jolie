import { describe, it, expect } from "vitest";
import { generateSku, buildSkuColorPart } from "@/lib/sku";

/**
 * SKU "visuel" pré-affiché côté formulaire dès qu'une couleur est attribuée
 * à une variante. Le rendu réutilise `generateSku` pour rester aligné avec
 * le SKU réel généré côté serveur à la sauvegarde — on vérifie ici que la
 * forme attendue (référence + couleurs + type + index) est bien produite.
 */

describe("Aperçu SKU pour une variante en cours de création", () => {
  it("formate correctement une variante UNIT avec une couleur unique", () => {
    expect(generateSku("BJ42", ["Rouge"], "UNIT", 1)).toBe("BJ42_ROUGE_UNIT_1");
  });

  it("concatène toutes les couleurs (principale + sous-couleurs) dans l'ordre", () => {
    expect(generateSku("BJ42", ["Doré", "Rouge", "Noir"], "UNIT", 2))
      .toBe("BJ42_DORE-ROUGE-NOIR_UNIT_2");
  });

  it("normalise les accents et la casse de la couleur", () => {
    expect(buildSkuColorPart(["Émeraude"])).toBe("EMERAUDE");
  });

  it("distingue UNIT et PACK", () => {
    expect(generateSku("REF1", ["Bleu"], "PACK", 3)).toBe("REF1_BLEU_PACK_3");
  });

  it("gère le cas où aucune couleur n'est encore définie", () => {
    expect(buildSkuColorPart([])).toBe("SANS-COULEUR");
  });
});
