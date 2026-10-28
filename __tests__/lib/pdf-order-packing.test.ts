import { describe, it, expect } from "vitest";
import {
  groupItemsForPacking,
  formatPackingVariant,
  type OrderItemPDF,
} from "@/lib/pdf-order";

function makeItem(partial: Partial<OrderItemPDF>): OrderItemPDF {
  return {
    productName:  "Produit X",
    productRef:   "REF-001",
    colorName:    "Rouge",
    categoryName: null,
    saleType:     "UNIT",
    packQty:      null,
    size:         null,
    sizesJson:    null,
    packDetails:  null,
    imagePath:    null,
    unitPrice:    10,
    quantity:     1,
    lineTotal:    10,
    ...partial,
  };
}

describe("groupItemsForPacking", () => {
  it("groupe plusieurs couleurs d'un même produit sur une seule ligne", () => {
    const items = [
      makeItem({ productRef: "REF-A", colorName: "Rouge", quantity: 2 }),
      makeItem({ productRef: "REF-A", colorName: "Bleu",  quantity: 1 }),
      makeItem({ productRef: "REF-B", colorName: "Vert",  quantity: 3 }),
    ];
    const groups = groupItemsForPacking(items);

    expect(groups).toHaveLength(2);
    expect(groups[0].productRef).toBe("REF-A");
    expect(groups[0].variants.map((v) => v.colorName)).toEqual(["Rouge", "Bleu"]);
    expect(groups[0].totalQty).toBe(3);
    expect(groups[1].productRef).toBe("REF-B");
    expect(groups[1].totalQty).toBe(3);
  });

  it("décompose sizesJson en tailles détaillées", () => {
    const items = [
      makeItem({
        productRef: "REF-S",
        colorName:  "Rouge",
        sizesJson:  JSON.stringify([
          { name: "38", quantity: 2 },
          { name: "40", quantity: 1 },
        ]),
        quantity:   3,
      }),
    ];
    const [group] = groupItemsForPacking(items);
    expect(group.variants[0].sizes).toEqual([
      { name: "38", qty: 2 },
      { name: "40", qty: 1 },
    ]);
  });

  it("fallback sur size legacy quand sizesJson absent", () => {
    const items = [
      makeItem({ productRef: "REF-L", colorName: "Noir", size: "M", quantity: 5 }),
    ];
    const [group] = groupItemsForPacking(items);
    expect(group.variants[0].sizes).toEqual([{ name: "M", qty: 5 }]);
  });

  it("récupère l'image depuis le 1er item qui en a une", () => {
    const items = [
      makeItem({ productRef: "REF-I", colorName: "A", imagePath: null }),
      makeItem({ productRef: "REF-I", colorName: "B", imagePath: "/uploads/x.webp" }),
    ];
    const [g] = groupItemsForPacking(items);
    expect(g.imagePath).toBe("/uploads/x.webp");
  });

  it("accumule totalQty = somme des quantités réelles de chaque ligne", () => {
    const items = [
      makeItem({ productRef: "REF-Q", colorName: "A", quantity: 4 }),
      makeItem({ productRef: "REF-Q", colorName: "B", quantity: 7 }),
    ];
    const [g] = groupItemsForPacking(items);
    expect(g.totalQty).toBe(11);
  });

  it("ignore un sizesJson corrompu et retombe sur size", () => {
    const items = [
      makeItem({ productRef: "REF-X", sizesJson: "pas-du-json", size: "42", quantity: 2 }),
    ];
    const [g] = groupItemsForPacking(items);
    expect(g.variants[0].sizes).toEqual([{ name: "42", qty: 2 }]);
  });
});

describe("formatPackingVariant", () => {
  it("formate une variante en 'Couleur × quantité totale'", () => {
    const line = formatPackingVariant({
      colorName: "Rouge",
      sizes:     [{ name: "38", qty: 2 }, { name: "40", qty: 1 }],
      totalQty:  3,
      saleType:  "UNIT",
      packQty:   null,
    });
    expect(line).toBe("Rouge × 3");
  });

  it("fonctionne sans taille (quantité unique)", () => {
    const line = formatPackingVariant({
      colorName: "Noir",
      sizes:     [{ name: null, qty: 7 }],
      totalQty:  7,
      saleType:  "UNIT",
      packQty:   null,
    });
    expect(line).toBe("Noir × 7");
  });

  it("agrège aussi un pack sous forme Couleur × total", () => {
    const line = formatPackingVariant({
      colorName: "Vert",
      sizes:     [{ name: null, qty: 5 }],
      totalQty:  5,
      saleType:  "PACK",
      packQty:   6,
    });
    expect(line).toBe("Vert × 5");
  });
});
