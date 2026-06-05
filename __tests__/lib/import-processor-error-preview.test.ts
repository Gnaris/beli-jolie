import { describe, it, expect } from "vitest";
import {
  buildProductErrorPreview,
  buildImageErrorPreview,
  ERROR_PREVIEW_LIMIT,
} from "@/lib/import-processor";

describe("buildProductErrorPreview", () => {
  it("retourne une liste vide si aucune erreur", () => {
    expect(buildProductErrorPreview([])).toEqual([]);
  });

  it("convertit reference + errors en entrée d'aperçu", () => {
    const out = buildProductErrorPreview([
      { reference: "REF001", name: "Bracelet doré", errors: ["Couleur manquante."] },
    ]);
    expect(out).toEqual([
      { label: "REF001", sublabel: "Bracelet doré", errors: ["Couleur manquante."] },
    ]);
  });

  it("déduplique par référence (plusieurs rows du même produit en erreur)", () => {
    const out = buildProductErrorPreview([
      { reference: "REF001", errors: ["Catégorie manquante."] },
      { reference: "REF001", errors: ["Catégorie manquante."] },
      { reference: "REF002", errors: ["Composition manquante."] },
    ]);
    expect(out).toHaveLength(2);
    expect(out[0].label).toBe("REF001");
    expect(out[1].label).toBe("REF002");
  });

  it("remplace la référence vide par un libellé lisible", () => {
    const out = buildProductErrorPreview([{ errors: ["Référence manquante."] }]);
    expect(out[0].label).toBe("(sans référence)");
  });

  it("est plafonné à ERROR_PREVIEW_LIMIT entrées", () => {
    const rows = Array.from({ length: ERROR_PREVIEW_LIMIT + 20 }, (_, i) => ({
      reference: `REF${i}`,
      errors: ["X"],
    }));
    expect(buildProductErrorPreview(rows)).toHaveLength(ERROR_PREVIEW_LIMIT);
  });

  it("garde au plus 5 messages d'erreur par entrée", () => {
    const out = buildProductErrorPreview([
      { reference: "REF001", errors: ["a", "b", "c", "d", "e", "f", "g"] },
    ]);
    expect(out[0].errors).toEqual(["a", "b", "c", "d", "e"]);
  });
});

describe("buildImageErrorPreview", () => {
  it("retourne une liste vide si aucune erreur", () => {
    expect(buildImageErrorPreview([])).toEqual([]);
  });

  it("convertit filename + color + position en entrée d'aperçu", () => {
    const out = buildImageErrorPreview([
      { filename: "REF001_Doré_2.jpg", color: "Doré", position: 2, errors: ["Référence introuvable."] },
    ]);
    expect(out).toEqual([
      { label: "REF001_Doré_2.jpg", sublabel: "Doré · position 2", errors: ["Référence introuvable."] },
    ]);
  });

  it("garde uniquement les ERROR_PREVIEW_LIMIT dernières erreurs", () => {
    const rows = Array.from({ length: ERROR_PREVIEW_LIMIT + 5 }, (_, i) => ({
      filename: `f${i}.jpg`,
      errors: ["X"],
    }));
    const out = buildImageErrorPreview(rows);
    expect(out).toHaveLength(ERROR_PREVIEW_LIMIT);
    expect(out[0].label).toBe("f5.jpg");
  });

  it("gère sublabel vide quand couleur et position absentes", () => {
    const out = buildImageErrorPreview([{ filename: "bad.png", errors: ["Format invalide."] }]);
    expect(out[0].sublabel).toBeUndefined();
  });
});
