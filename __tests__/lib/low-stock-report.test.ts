import { describe, it, expect } from "vitest";
import {
  classifyStock,
  selectLowStockProducts,
  LOW_STOCK_THRESHOLD,
  type ProductColorForReport,
} from "@/lib/low-stock-report";

// ─────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────

let seq = 0;
const color = (over: Partial<ProductColorForReport> = {}): ProductColorForReport => {
  seq++;
  return {
    id:             `pc${seq}`,
    colorId:        `col-${seq}`,
    stock:          5,
    disabled:       false,
    color:          { name: "Rouge", hex: "#FF0000", patternImage: null },
    firstImagePath: null,
    ...over,
  };
};

const product = (id: string, ref: string, colors: ProductColorForReport[]) => ({
  id,
  reference: ref,
  name:      `Produit ${ref}`,
  category:  { name: "Bijoux" },
  colors,
});

// ─────────────────────────────────────────────
// classifyStock
// ─────────────────────────────────────────────

describe("classifyStock", () => {
  it("renvoie 'out' pour un stock nul ou négatif", () => {
    expect(classifyStock(0)).toBe("out");
    expect(classifyStock(-3)).toBe("out");
  });

  it("renvoie 'low' pour un stock entre 1 et seuil-1", () => {
    expect(classifyStock(1)).toBe("low");
    expect(classifyStock(5)).toBe("low");
    expect(classifyStock(LOW_STOCK_THRESHOLD - 1)).toBe("low");
  });

  it("renvoie null quand le stock atteint ou dépasse le seuil", () => {
    expect(classifyStock(LOW_STOCK_THRESHOLD)).toBeNull();
    expect(classifyStock(50)).toBeNull();
    expect(classifyStock(999)).toBeNull();
  });
});

// ─────────────────────────────────────────────
// selectLowStockProducts
// ─────────────────────────────────────────────

describe("selectLowStockProducts", () => {
  it("ne garde que les couleurs en stock faible", () => {
    const products = [
      product("p1", "A100", [
        color({ colorId: "rouge", stock: 0 }),
        color({ colorId: "vert",  stock: 42 }), // filtré : stock OK
        color({ colorId: "bleu",  stock: 7 }),
      ]),
    ];
    const out = selectLowStockProducts(products);
    expect(out).toHaveLength(1);
    expect(out[0].colors.map((c) => c.colorId).sort()).toEqual(["bleu", "rouge"]);
  });

  it("exclut totalement un produit dont aucune couleur n'est en alerte", () => {
    const products = [
      product("p1", "A100", [color({ stock: 20 }), color({ stock: 50 })]),
      product("p2", "A200", [color({ stock: 0 })]),
    ];
    const out = selectLowStockProducts(products);
    expect(out.map((p) => p.id)).toEqual(["p2"]);
  });

  it("ignore les variantes désactivées même si elles sont en rupture", () => {
    const products = [
      product("p1", "A100", [
        color({ stock: 0, disabled: true }),
        color({ stock: 15 }),
      ]),
    ];
    expect(selectLowStockProducts(products)).toEqual([]);
  });

  it("dédoublonne les couleurs partagées entre plusieurs variantes", () => {
    // Cas typique : UNIT + PACK sur la même couleur. On veut UNE ligne
    // « Rouge » et pas deux, avec la somme des stocks.
    const products = [
      product("p1", "A100", [
        color({ id: "unit-rouge", colorId: "rouge", stock: 3 }),
        color({ id: "pack-rouge", colorId: "rouge", stock: 2 }),
        color({ id: "unit-bleu",  colorId: "bleu",  stock: 0 }),
      ]),
    ];
    const out = selectLowStockProducts(products);
    expect(out).toHaveLength(1);
    // 2 lignes : Rouge (3+2=5, low) et Bleu (0, out).
    expect(out[0].colors).toHaveLength(2);
    const rouge = out[0].colors.find((c) => c.colorId === "rouge");
    expect(rouge?.stock).toBe(5);
    expect(rouge?.level).toBe("low");
    const bleu = out[0].colors.find((c) => c.colorId === "bleu");
    expect(bleu?.stock).toBe(0);
    expect(bleu?.level).toBe("out");
  });

  it("agrège 3 variantes de la même couleur en une seule ligne", () => {
    const products = [
      product("p1", "A100", [
        color({ colorId: "or", stock: 2 }),
        color({ colorId: "or", stock: 3 }),
        color({ colorId: "or", stock: 4 }),
      ]),
    ];
    const out = selectLowStockProducts(products);
    // Somme = 9 (< 10) → 1 ligne « or » avec stock 9.
    expect(out[0].colors).toHaveLength(1);
    expect(out[0].colors[0].stock).toBe(9);
    expect(out[0].colors[0].level).toBe("low");
  });

  it("exclut une couleur dont la somme atteint le seuil (5+5=10)", () => {
    const products = [
      product("p1", "A100", [
        color({ colorId: "or", stock: 5 }),
        color({ colorId: "or", stock: 5 }),
      ]),
    ];
    // Total = 10, pas d'alerte, produit exclu.
    expect(selectLowStockProducts(products)).toEqual([]);
  });

  it("récupère firstImagePath de la 1re variante non-null lors du dédoublonnage", () => {
    const products = [
      product("p1", "A100", [
        color({ colorId: "or", stock: 1, firstImagePath: null }),
        color({ colorId: "or", stock: 1, firstImagePath: "/uploads/motif.webp" }),
      ]),
    ];
    const out = selectLowStockProducts(products);
    expect(out[0].colors[0].firstImagePath).toBe("/uploads/motif.webp");
  });

  it("ignore les variantes sans colorId (données legacy)", () => {
    const products = [
      product("p1", "A100", [
        color({ colorId: null, stock: 0 }),
        color({ colorId: "rouge", stock: 3 }),
      ]),
    ];
    const out = selectLowStockProducts(products);
    expect(out[0].colors).toHaveLength(1);
    expect(out[0].colors[0].colorId).toBe("rouge");
  });

  it("trie les couleurs : ruptures d'abord puis stock croissant", () => {
    const products = [
      product("p1", "A100", [
        color({ colorId: "a", stock: 8 }),
        color({ colorId: "b", stock: 0 }),
        color({ colorId: "c", stock: 2 }),
        color({ colorId: "d", stock: 0 }),
      ]),
    ];
    const out = selectLowStockProducts(products);
    expect(out[0].colors.map((c) => c.stock)).toEqual([0, 0, 2, 8]);
    expect(out[0].colors.map((c) => c.level)).toEqual(["out", "out", "low", "low"]);
  });

  it("trie les produits par nombre de ruptures décroissant, puis par référence", () => {
    const products = [
      product("p1", "A200", [color({ stock: 3 })]),
      product("p2", "A100", [color({ stock: 0 }), color({ stock: 0 })]),
      product("p3", "A150", [color({ stock: 0 }), color({ stock: 5 })]),
    ];
    const out = selectLowStockProducts(products);
    expect(out.map((p) => p.reference)).toEqual(["A100", "A150", "A200"]);
  });

  it("expose category, patternImage, hex et firstImagePath pour le PDF", () => {
    const products = [
      product("p1", "A100", [
        color({
          colorId:        "bleu",
          stock:          0,
          color:          { name: "Bleu marine", hex: "#001F3F", patternImage: "/uploads/motif.webp" },
          firstImagePath: "/uploads/produits/A100/A100-bleu-1.webp",
        }),
      ]),
    ];
    const out = selectLowStockProducts(products);
    expect(out[0].category).toBe("Bijoux");
    expect(out[0].colors[0].color?.hex).toBe("#001F3F");
    expect(out[0].colors[0].color?.patternImage).toBe("/uploads/motif.webp");
    expect(out[0].colors[0].firstImagePath).toBe("/uploads/produits/A100/A100-bleu-1.webp");
  });

  it("tolère l'absence de catégorie", () => {
    const products = [{
      id: "p1", reference: "A100", name: "Sans cat", colors: [color({ stock: 0 })],
    }];
    expect(selectLowStockProducts(products)[0].category).toBeNull();
  });

  it("renvoie une liste vide quand tous les stocks sont OK", () => {
    const products = [
      product("p1", "A100", [color({ stock: 100 })]),
      product("p2", "A200", [color({ stock: LOW_STOCK_THRESHOLD })]),
    ];
    expect(selectLowStockProducts(products)).toEqual([]);
  });
});
