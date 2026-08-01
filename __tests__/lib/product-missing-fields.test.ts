import { describe, it, expect } from "vitest";
import {
  computeMissingProductFields,
  MISSING_FIELD_ORDER,
  type MissingFieldsInput,
} from "@/lib/product-missing-fields";

function fullyValidInput(overrides: Partial<MissingFieldsInput> = {}): MissingFieldsInput {
  return {
    status: "ONLINE",
    reference: "PROD-42",
    description: "Description assez longue pour dépasser les 30 caractères.",
    categoryId: "cat-1",
    countryIsoCode: "CN",
    seasonId: "season-1",
    compositions: [{ percentage: 100 }],
    colors: [
      {
        disabled: false,
        unitPrice: 12.5,
        weight: 200,
        stock: 5,
        variantSizes: [{ sizeId: "size-tu" }],
        packLines: [],
      },
    ],
    ...overrides,
  };
}

describe("computeMissingProductFields", () => {
  it("returns [] when everything is filled", () => {
    expect(computeMissingProductFields(fullyValidInput())).toEqual([]);
  });

  it("returns [] for ARCHIVED products even when everything is missing", () => {
    const input = fullyValidInput({
      status: "ARCHIVED",
      categoryId: null,
      countryIsoCode: null,
      seasonId: null,
      compositions: [],
      description: "",
    });
    expect(computeMissingProductFields(input)).toEqual([]);
  });

  it("flags each field-level miss individually", () => {
    expect(computeMissingProductFields(fullyValidInput({ categoryId: null }))).toContain("category");
    expect(computeMissingProductFields(fullyValidInput({ countryIsoCode: null }))).toContain("country");
    expect(computeMissingProductFields(fullyValidInput({ seasonId: null }))).toContain("season");
  });

  it("flags description when < 30 effective chars (empty description case)", () => {
    // Une référence courte "P1" n'apporte que ~30 chars de suffixe Ankor,
    // donc description vide reste strictement sous le seuil.
    const input = fullyValidInput({ description: "", reference: "P1" });
    expect(computeMissingProductFields(input)).toContain("description");
  });

  it("counts the Ankorstore reference suffix in the description length", () => {
    // Description vide + référence longue : suffixe ankor ("\n\nRef : XXX")
    // dépasse déjà 30 chars, donc la description n'est PAS flaguée manquante.
    const input = fullyValidInput({
      description: "",
      reference: "REFERENCE-TRES-LONGUE-EN-BOUTIQUE",
    });
    expect(computeMissingProductFields(input)).not.toContain("description");
  });

  it("flags composition when total != 100", () => {
    expect(
      computeMissingProductFields(
        fullyValidInput({ compositions: [{ percentage: 80 }] }),
      ),
    ).toContain("composition");
  });

  it("tolerates composition rounding within 0.5%", () => {
    expect(
      computeMissingProductFields(
        fullyValidInput({ compositions: [{ percentage: 99.6 }] }),
      ),
    ).not.toContain("composition");
  });

  it("flags composition when empty", () => {
    expect(
      computeMissingProductFields(fullyValidInput({ compositions: [] })),
    ).toContain("composition");
  });

  it("flags variant-level fields (prices/weights/stocks/sizes)", () => {
    const input = fullyValidInput({
      colors: [
        {
          disabled: false,
          unitPrice: 0,
          weight: null,
          stock: null,
          variantSizes: [],
          packLines: [],
        },
      ],
    });
    const missing = computeMissingProductFields(input);
    expect(missing).toEqual(expect.arrayContaining(["prices", "weights", "stocks", "sizes"]));
  });

  it("ignores disabled variants for variant-level checks", () => {
    const input = fullyValidInput({
      colors: [
        // Variante active parfaitement remplie.
        {
          disabled: false,
          unitPrice: 15,
          weight: 100,
          stock: 3,
          variantSizes: [{ sizeId: "size-tu" }],
          packLines: [],
        },
        // Variante DÉSACTIVÉE avec plein de champs manquants → ne doit rien flaguer.
        {
          disabled: true,
          unitPrice: 0,
          weight: null,
          stock: null,
          variantSizes: [],
          packLines: [],
        },
      ],
    });
    expect(computeMissingProductFields(input)).toEqual([]);
  });

  it("checks sizes on packLines[].sizes for multi-color PACK variants", () => {
    // PACK multi-couleurs : variantSizes est vide MAIS packLines doit avoir
    // au moins 1 taille par ligne. Ici la 2e ligne du pack est sans taille.
    const input = fullyValidInput({
      colors: [
        {
          disabled: false,
          unitPrice: 30,
          weight: 250,
          stock: 4,
          variantSizes: [],
          packLines: [
            { sizes: [{ sizeId: "size-tu" }] },
            { sizes: [] }, // ligne pack sans taille → sizes manquant
          ],
        },
      ],
    });
    expect(computeMissingProductFields(input)).toContain("sizes");
  });

  it("does NOT flag sizes when every PACK line has at least one size", () => {
    const input = fullyValidInput({
      colors: [
        {
          disabled: false,
          unitPrice: 30,
          weight: 250,
          stock: 4,
          variantSizes: [],
          packLines: [
            { sizes: [{ sizeId: "size-s" }] },
            { sizes: [{ sizeId: "size-m" }] },
          ],
        },
      ],
    });
    expect(computeMissingProductFields(input)).not.toContain("sizes");
  });

  it("returns missing fields in MISSING_FIELD_ORDER (deterministic)", () => {
    const input = fullyValidInput({
      categoryId: null,
      seasonId: null,
      countryIsoCode: null,
      compositions: [],
      description: "",
      reference: "P1",
      colors: [
        {
          disabled: false,
          unitPrice: 0,
          weight: null,
          stock: null,
          variantSizes: [],
          packLines: [],
        },
      ],
    });
    const missing = computeMissingProductFields(input);
    // La liste doit respecter l'ordre canonique (pas d'ordre dépendant du Set).
    const indexOf = (f: string) => MISSING_FIELD_ORDER.indexOf(f as typeof MISSING_FIELD_ORDER[number]);
    for (let i = 1; i < missing.length; i++) {
      expect(indexOf(missing[i])).toBeGreaterThan(indexOf(missing[i - 1]));
    }
    expect(missing).toEqual([
      "category",
      "description",
      "composition",
      "country",
      "season",
      "prices",
      "weights",
      "stocks",
      "sizes",
    ]);
  });

  it("does NOT flag prices/weights/stocks when values are valid", () => {
    const input = fullyValidInput({
      colors: [
        {
          disabled: false,
          unitPrice: 0.01,
          weight: 0.1,
          stock: 0, // 0 est une valeur valide (stock à zéro), pas null
          variantSizes: [{ sizeId: "size-tu" }],
          packLines: [],
        },
      ],
    });
    const missing = computeMissingProductFields(input);
    expect(missing).not.toContain("prices");
    expect(missing).not.toContain("weights");
    expect(missing).not.toContain("stocks");
  });
});
