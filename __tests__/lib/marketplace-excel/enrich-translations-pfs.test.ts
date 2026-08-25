import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock l'API PFS — on contrôle ce qu'elle renvoie pour chaque appel.
const mockTranslate = vi.fn();
vi.mock("@/lib/pfs-translate", () => ({
  translateToAllLocales: (...args: unknown[]) => mockTranslate(...args),
}));

import { enrichProductsWithPfsTranslations } from "@/lib/marketplace-excel/enrich-translations-pfs";
import type { ExportProduct } from "@/lib/marketplace-excel/types";

function makeProduct(over: Partial<ExportProduct> = {}): ExportProduct {
  return {
    id: "p1",
    reference: "REF",
    name: "Collier FR",
    description: "Description FR",
    status: "ONLINE",
    pfsGenderCode: "WOMAN",
    pfsFamilyName: "Bijoux_Fantaisie",
    pfsCategoryName: "Colliers",
    categoryName: "Colliers",
    microstoreCategoryOverride: null,
    hsCode: null,
    efashionCategorieId: null,
    efashionCategoryPath: null,
    seasonPfsRef: null,
    seasonEfashionCollectionId: null,
    seasonEfashionLabel: null,
    seasonName: null,
    manufacturingCountryName: "Chine",
    manufacturingCountryIso: "CN",
    manufacturingCountryEfashionProvenanceId: null,
    compositions: [],
    dimensionLength: null,
    dimensionWidth: null,
    dimensionHeight: null,
    dimensionDiameter: null,
    dimensionCircumference: null,
    translations: {},
    variants: [],
    ...over,
  };
}

describe("enrichProductsWithPfsTranslations", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("ajoute les traductions manquantes (EN/ES/DE/IT) à partir d'un seul appel PFS par texte", async () => {
    mockTranslate
      .mockResolvedValueOnce({ en: "Necklace", es: "Collar", de: "Halskette", it: "Collana" })
      .mockResolvedValueOnce({ en: "Description EN", es: "Descripción", de: "Beschreibung", it: "Descrizione" });

    const products = [makeProduct()];
    const out = await enrichProductsWithPfsTranslations(products);

    expect(mockTranslate).toHaveBeenCalledTimes(2); // 1 nom + 1 description
    expect(mockTranslate).toHaveBeenNthCalledWith(1, "Collier FR");
    expect(mockTranslate).toHaveBeenNthCalledWith(2, "Description FR");

    expect(out[0].translations.en).toEqual({ name: "Necklace", description: "Description EN" });
    expect(out[0].translations.es).toEqual({ name: "Collar", description: "Descripción" });
    expect(out[0].translations.de).toEqual({ name: "Halskette", description: "Beschreibung" });
    expect(out[0].translations.it).toEqual({ name: "Collana", description: "Descrizione" });
  });

  it("conserve une traduction EN existante au lieu de la regénérer", async () => {
    mockTranslate.mockResolvedValue({ es: "X", de: "Y", it: "Z" });

    const products = [
      makeProduct({
        translations: { en: { name: "Manual EN", description: "Manual EN desc" } },
      }),
    ];
    const out = await enrichProductsWithPfsTranslations(products);

    expect(out[0].translations.en).toEqual({ name: "Manual EN", description: "Manual EN desc" });
    expect(out[0].translations.es?.name).toBe("X");
  });

  it("ne mute pas le produit d'entrée", async () => {
    mockTranslate.mockResolvedValue({ en: "x", es: "y", de: "z", it: "w" });

    const input = makeProduct();
    const inputTranslationsRef = input.translations;
    await enrichProductsWithPfsTranslations([input]);

    expect(input.translations).toBe(inputTranslationsRef);
    expect(input.translations.en).toBeUndefined();
  });

  it("ne fait aucun appel PFS si toutes les locales sont déjà présentes", async () => {
    const products = [
      makeProduct({
        translations: {
          en: { name: "A", description: "a" },
          es: { name: "B", description: "b" },
          de: { name: "C", description: "c" },
          it: { name: "D", description: "d" },
        },
      }),
    ];
    await enrichProductsWithPfsTranslations(products);
    expect(mockTranslate).not.toHaveBeenCalled();
  });

  it("ne traduit pas la description si elle est vide côté FR", async () => {
    mockTranslate.mockResolvedValue({ en: "x", es: "y", de: "z", it: "w" });

    const products = [makeProduct({ description: "" })];
    await enrichProductsWithPfsTranslations(products);
    expect(mockTranslate).toHaveBeenCalledTimes(1); // nom uniquement
  });

  it("retombe gracieusement quand PFS ne renvoie qu'une partie des langues", async () => {
    // PFS renvoie seulement EN — DE/ES/IT manquent
    mockTranslate.mockResolvedValue({ en: "Necklace" });

    const products = [makeProduct()];
    const out = await enrichProductsWithPfsTranslations(products);

    expect(out[0].translations.en?.name).toBe("Necklace");
    // Pas de traduction stockée pour les langues manquantes
    expect(out[0].translations.es).toBeUndefined();
    expect(out[0].translations.de).toBeUndefined();
    expect(out[0].translations.it).toBeUndefined();
  });
});
