import { describe, it, expect } from "vitest";
import { computeChecklist } from "@/components/admin/products/CompletenessChecklist";
import type { ChecklistInput } from "@/components/admin/products/CompletenessChecklist";
import type { VariantState, ColorImageState } from "@/components/admin/products/ColorVariantManager";

function makeVariant(overrides: Partial<VariantState> = {}): VariantState {
  return {
    tempId: "v1",
    colorId: "c1",
    colorName: "Rouge",
    colorHex: "#FF0000",
    subColors: [],
    sizeEntries: [{ tempId: "s1", sizeId: "sz1", sizeName: "TU", quantity: "1" }],
    unitPrice: "10",
    weight: "0.5",
    stock: "100",
    isPrimary: true,
    saleType: "UNIT",
    packQuantity: "",
    pfsColorRef: "",
    sku: "",
    ...overrides,
  };
}

function makeColorImage(overrides: Partial<ColorImageState> = {}): ColorImageState {
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
    description: "Description test",
    categoryId: "cat1",
    compositions: [{ compositionId: "comp1", percentage: "100" }],
    variants: [makeVariant()],
    colorImages: [makeColorImage()],
    ...overrides,
  };
}

describe("computeChecklist", () => {
  it("returns all items done for a complete product", () => {
    const items = computeChecklist(makeInput());
    const allDone = items.every((i) => i.done);
    expect(allDone).toBe(true);
    expect(items.length).toBeGreaterThanOrEqual(10);
  });

  it("marks reference as not done when empty", () => {
    const items = computeChecklist(makeInput({ reference: "" }));
    const ref = items.find((i) => i.key === "reference");
    expect(ref?.done).toBe(false);
  });

  it("marks name as not done when empty", () => {
    const items = computeChecklist(makeInput({ name: "  " }));
    const n = items.find((i) => i.key === "name");
    expect(n?.done).toBe(false);
  });

  it("marks description as not done when empty", () => {
    const items = computeChecklist(makeInput({ description: "" }));
    const d = items.find((i) => i.key === "description");
    expect(d?.done).toBe(false);
  });

  it("marks category as not done when empty", () => {
    const items = computeChecklist(makeInput({ categoryId: "" }));
    const c = items.find((i) => i.key === "category");
    expect(c?.done).toBe(false);
  });

  it("marks composition as not done when empty", () => {
    const items = computeChecklist(makeInput({ compositions: [] }));
    const c = items.find((i) => i.key === "composition");
    expect(c?.done).toBe(false);
  });

  it("marks composition as not done when total != 100%", () => {
    const items = computeChecklist(
      makeInput({
        compositions: [
          { compositionId: "c1", percentage: "60" },
          { compositionId: "c2", percentage: "30" },
        ],
      })
    );
    const c = items.find((i) => i.key === "composition");
    expect(c?.done).toBe(false);
    expect(c?.detail).toContain("90.0%");
  });

  it("marks composition as done when total within 0.5% tolerance", () => {
    const items = computeChecklist(
      makeInput({
        compositions: [
          { compositionId: "c1", percentage: "99.6" },
          { compositionId: "c2", percentage: "0.2" },
        ],
      })
    );
    const c = items.find((i) => i.key === "composition");
    expect(c?.done).toBe(true);
  });

  it("marks variants as not done when empty", () => {
    const items = computeChecklist(makeInput({ variants: [] }));
    const v = items.find((i) => i.key === "variants");
    expect(v?.done).toBe(false);
    // Should not have price/weight/stock/sizes/images items when no variants
    expect(items.find((i) => i.key === "prices")).toBeUndefined();
  });

  it("marks prices as not done when variant has invalid price", () => {
    const items = computeChecklist(
      makeInput({ variants: [makeVariant({ unitPrice: "" })] })
    );
    const p = items.find((i) => i.key === "prices");
    expect(p?.done).toBe(false);
  });

  it("marks weights as not done when variant has zero weight", () => {
    const items = computeChecklist(
      makeInput({ variants: [makeVariant({ weight: "0" })] })
    );
    const w = items.find((i) => i.key === "weights");
    expect(w?.done).toBe(false);
  });

  it("marks stocks as not done when variant has empty stock", () => {
    const items = computeChecklist(
      makeInput({ variants: [makeVariant({ stock: "" })] })
    );
    const s = items.find((i) => i.key === "stocks");
    expect(s?.done).toBe(false);
  });

  it("marks sizes as not done when variant has no sizes", () => {
    const items = computeChecklist(
      makeInput({ variants: [makeVariant({ sizeEntries: [] })] })
    );
    const s = items.find((i) => i.key === "sizes");
    expect(s?.done).toBe(false);
  });

  it("marks PACK sizes as done when the variant has size entries", () => {
    const packVariant = makeVariant({
      saleType: "PACK",
      packQuantity: "2",
      sizeEntries: [
        { tempId: "s1", sizeId: "sz1", sizeName: "M", quantity: "1" },
        { tempId: "s2", sizeId: "sz2", sizeName: "L", quantity: "1" },
      ],
    });
    const items = computeChecklist(makeInput({ variants: [packVariant] }));
    const s = items.find((i) => i.key === "sizes");
    expect(s?.done).toBe(true);
  });

  it("marks PACK sizes as NOT done when sizeEntries is empty", () => {
    const packVariant = makeVariant({
      saleType: "PACK",
      packQuantity: "1",
      sizeEntries: [],
    });
    const items = computeChecklist(makeInput({ variants: [packVariant] }));
    const s = items.find((i) => i.key === "sizes");
    expect(s?.done).toBe(false);
  });

  it("marks images as not done when no images for a variant color", () => {
    const items = computeChecklist(
      makeInput({ colorImages: [makeColorImage({ uploadedPaths: [] })] })
    );
    const img = items.find((i) => i.key === "images");
    expect(img?.done).toBe(false);
    expect(img?.detail).toContain("1 couleur(s) sans image");
  });

  it("handles multiple variants with different completeness", () => {
    const v1 = makeVariant({ tempId: "v1", unitPrice: "10" });
    const v2 = makeVariant({ tempId: "v2", colorId: "c2", colorName: "Bleu", colorHex: "#0000FF", unitPrice: "" });
    const items = computeChecklist(
      makeInput({
        variants: [v1, v2],
        colorImages: [
          makeColorImage(),
          makeColorImage({ groupKey: "c2", colorId: "c2", colorName: "Bleu" }),
        ],
      })
    );
    const p = items.find((i) => i.key === "prices");
    expect(p?.done).toBe(false);
    expect(p?.detail).toContain("1 manquant");
  });
});
