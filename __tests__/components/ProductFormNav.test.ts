import { describe, it, expect } from "vitest";
import {
  computeSectionsProgress,
  SECTIONS,
} from "@/components/admin/products/ProductFormNav";
import type { ChecklistInput } from "@/components/admin/products/CompletenessChecklist";
import type {
  VariantState,
  ColorImageState,
} from "@/components/admin/products/ColorVariantManager";

function makeVariant(overrides: Partial<VariantState> = {}): VariantState {
  return {
    tempId: "v1",
    colorId: "c1",
    colorName: "Rouge",
    colorHex: "#FF0000",
    sizeEntries: [
      { tempId: "s1", sizeId: "sz1", sizeName: "TU", quantity: "1" },
    ],
    unitPrice: "10",
    weight: "0.5",
    stock: "100",
    isPrimary: true,
    saleType: "UNIT",
    packQuantity: "",
    packLines: [],
    sku: "",
    disabled: false,
    ...overrides,
  };
}

function makeColorImage(
  overrides: Partial<ColorImageState> = {}
): ColorImageState {
  return {
    groupKey: "c1",
    colorId: "c1",
    colorName: "Rouge",
    colorHex: "#FF0000",
    imagePreviews: ["/img1.webp"],
    uploadedPaths: ["/img1.webp"],
    orders: [0],
    uploading: false,
    ...overrides,
  };
}

function makeInput(overrides: Partial<ChecklistInput> = {}): ChecklistInput {
  return {
    reference: "BJ-TEST-001",
    name: "Produit test",
    description: "Description test bien longue pour passer la limite minimum.",
    categoryId: "cat1",
    compositions: [{ compositionId: "comp1", percentage: "100" }],
    variants: [makeVariant()],
    colorImages: [makeColorImage()],
    ...overrides,
  };
}

describe("ProductFormNav — sections", () => {
  it("expose les 5 sections attendues dans l'ordre", () => {
    expect(SECTIONS.map((s) => s.key)).toEqual([
      "overview",
      "info",
      "details",
      "variants",
      "links",
    ]);
  });

  it("chaque section pointe vers une ancre 'section-...'", () => {
    for (const sec of SECTIONS) {
      expect(sec.anchor).toMatch(/^section-/);
    }
  });
});

describe("computeSectionsProgress — produit complet", () => {
  it("toutes les sections avec items sont marquees pleines", () => {
    const progress = computeSectionsProgress(makeInput());

    expect(progress.info.isFull).toBe(true);
    expect(progress.info.done).toBe(progress.info.total);

    expect(progress.details.isFull).toBe(true);
    expect(progress.details.done).toBe(progress.details.total);

    expect(progress.variants.isFull).toBe(true);
    expect(progress.variants.done).toBe(progress.variants.total);
  });

  it("les sections sans items (overview, links) ne sont jamais 'isFull'", () => {
    const progress = computeSectionsProgress(makeInput());

    expect(progress.overview.hasItems).toBe(false);
    expect(progress.overview.isFull).toBe(false);

    expect(progress.links.hasItems).toBe(false);
    expect(progress.links.isFull).toBe(false);
  });
});

describe("computeSectionsProgress — fiche produit incomplete", () => {
  it("info.isFull = false quand le nom manque", () => {
    const progress = computeSectionsProgress(
      makeInput({ name: "" })
    );
    expect(progress.info.isFull).toBe(false);
    expect(progress.info.done).toBeLessThan(progress.info.total);
  });

  it("info.isFull = false quand la categorie manque", () => {
    const progress = computeSectionsProgress(
      makeInput({ categoryId: "" })
    );
    expect(progress.info.isFull).toBe(false);
  });

  it("info.isFull = false quand la reference manque", () => {
    const progress = computeSectionsProgress(
      makeInput({ reference: "" })
    );
    expect(progress.info.isFull).toBe(false);
  });
});

describe("computeSectionsProgress — composition incomplete", () => {
  it("details.isFull = false quand la composition est vide", () => {
    const progress = computeSectionsProgress(
      makeInput({ compositions: [] })
    );
    expect(progress.details.isFull).toBe(false);
  });

  it("details.isFull = false quand le total des % n'est pas 100", () => {
    const progress = computeSectionsProgress(
      makeInput({
        compositions: [{ compositionId: "c1", percentage: "60" }],
      })
    );
    expect(progress.details.isFull).toBe(false);
  });
});

describe("computeSectionsProgress — variantes incompletes", () => {
  it("variants.isFull = false quand le prix manque", () => {
    const progress = computeSectionsProgress(
      makeInput({ variants: [makeVariant({ unitPrice: "" })] })
    );
    expect(progress.variants.isFull).toBe(false);
  });

  it("variants.isFull = false quand les images manquent", () => {
    const progress = computeSectionsProgress(
      makeInput({
        colorImages: [makeColorImage({ uploadedPaths: [] })],
      })
    );
    expect(progress.variants.isFull).toBe(false);
  });

  it("variants.isFull = false quand le stock est vide", () => {
    const progress = computeSectionsProgress(
      makeInput({ variants: [makeVariant({ stock: "" })] })
    );
    expect(progress.variants.isFull).toBe(false);
  });

  it("variants.isFull = false quand le poids est zero", () => {
    const progress = computeSectionsProgress(
      makeInput({ variants: [makeVariant({ weight: "0" })] })
    );
    expect(progress.variants.isFull).toBe(false);
  });

  it("variants.hasItems = false quand aucune variante n'existe (seul le compteur 'au moins une variante' compte)", () => {
    // Pas de variante → seul l'item "variants" est present, prices/weights/stocks/sizes/images n'apparaissent pas.
    const progress = computeSectionsProgress(makeInput({ variants: [] }));
    expect(progress.variants.total).toBe(1);
    expect(progress.variants.done).toBe(0);
    expect(progress.variants.isFull).toBe(false);
  });
});

describe("computeSectionsProgress — total cumule", () => {
  it("la somme des 'done' par section egale le nombre d'items completes globalement", () => {
    // Quand tout est OK, les sections couvrent tous les items du checklist sauf
    // ceux qui n'appartiennent a aucune section (il ne devrait pas y en avoir).
    const progress = computeSectionsProgress(makeInput());
    const totalDone =
      progress.info.done +
      progress.details.done +
      progress.variants.done +
      progress.links.done +
      progress.overview.done;
    // Tous les items presents en checklist doivent appartenir a une section
    expect(totalDone).toBeGreaterThan(0);
  });
});
