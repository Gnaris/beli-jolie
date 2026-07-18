import { describe, it, expect } from "vitest";

// Réplique la logique de filtrage + groupement de CartPageClient.tsx
// (Phase 1 refonte panier : recherche + regroupement par catégorie + progression minimum)

type Variant = {
  unitPrice: number;
  saleType: "UNIT" | "PACK";
  packQuantity: number | null;
  color: { name: string } | null;
  product: {
    name: string;
    reference: string;
    discountPercent?: number | null;
    category: { name: string };
  };
};

type Item = { id: string; quantity: number; variant: Variant };

function computeUnitPrice(v: Variant): number {
  const base = Number(v.unitPrice);
  const dp = v.product.discountPercent != null ? Number(v.product.discountPercent) : null;
  if (!dp || dp <= 0) return base;
  return Math.max(0, base * (1 - dp / 100));
}

function filterItems(items: Item[], query: string): Item[] {
  if (!query.trim()) return items;
  const q = query.trim().toLowerCase();
  return items.filter((item) => {
    const v = item.variant;
    const name = v.product.name.toLowerCase();
    const ref = v.product.reference.toLowerCase();
    const color = v.color ? v.color.name.toLowerCase() : "";
    return name.includes(q) || ref.includes(q) || color.includes(q);
  });
}

function groupByCategory(items: Item[]): Record<string, Item[]> {
  const g: Record<string, Item[]> = {};
  items.forEach((item) => {
    const cat = item.variant.product.category.name;
    if (!g[cat]) g[cat] = [];
    g[cat].push(item);
  });
  return g;
}

function computeSubtotal(items: Item[]): number {
  return items.reduce((s, item) => s + computeUnitPrice(item.variant) * item.quantity, 0);
}

function computeTotalUnits(items: Item[]): number {
  return items.reduce((s, item) => {
    const units = item.variant.saleType === "PACK"
      ? (item.variant.packQuantity ?? 1) * item.quantity
      : item.quantity;
    return s + units;
  }, 0);
}

function make(
  id: string,
  qty: number,
  name: string,
  reference: string,
  category: string,
  colorName: string | null,
  unitPrice: number,
  discountPercent: number | null = null,
  saleType: "UNIT" | "PACK" = "UNIT",
  packQuantity: number | null = null,
): Item {
  return {
    id,
    quantity: qty,
    variant: {
      unitPrice,
      saleType,
      packQuantity,
      color: colorName ? { name: colorName } : null,
      product: { name, reference, discountPercent, category: { name: category } },
    },
  };
}

describe("Panier v6 — filtrage recherche", () => {
  const items: Item[] = [
    make("a", 2, "Jonc thaïlandais", "BR-JEM-98", "Bracelets", "Corail", 98),
    make("b", 5, "Bracelet chaîne double", "BR-CHDBL-OR", "Bracelets", "Doré", 42.5, 15),
    make("c", 1, "Créoles inox", "BO-CINOX-72", "Boucles d'oreilles", "Noir", 72),
    make("d", 3, "Collier chaîne fine", "COL-CHFIN-54", "Colliers", "Argent", 54),
  ];

  it("retourne tous les items si la recherche est vide", () => {
    expect(filterItems(items, "").length).toBe(4);
    expect(filterItems(items, "   ").length).toBe(4);
  });

  it("filtre sur le nom du produit (insensible casse)", () => {
    const r = filterItems(items, "JONC");
    expect(r.length).toBe(1);
    expect(r[0].id).toBe("a");
  });

  it("filtre sur la référence", () => {
    const r = filterItems(items, "chdbl");
    expect(r.length).toBe(1);
    expect(r[0].id).toBe("b");
  });

  it("filtre sur le nom de couleur", () => {
    const r = filterItems(items, "doré");
    expect(r.length).toBe(1);
    expect(r[0].id).toBe("b");
  });

  it("retourne un tableau vide si aucun match", () => {
    expect(filterItems(items, "xyz-inexistant").length).toBe(0);
  });
});

describe("Panier v6 — groupement par catégorie", () => {
  it("groupe correctement 3 catégories distinctes", () => {
    const items: Item[] = [
      make("a", 1, "Jonc", "BR-1", "Bracelets", null, 10),
      make("b", 1, "Chaîne", "BR-2", "Bracelets", null, 10),
      make("c", 1, "Créole", "BO-1", "Boucles d'oreilles", null, 10),
      make("d", 1, "Collier", "COL-1", "Colliers", null, 10),
    ];
    const g = groupByCategory(items);
    expect(Object.keys(g).sort()).toEqual(["Boucles d'oreilles", "Bracelets", "Colliers"]);
    expect(g["Bracelets"].length).toBe(2);
    expect(g["Boucles d'oreilles"].length).toBe(1);
    expect(g["Colliers"].length).toBe(1);
  });

  it("supporte 50 articles répartis sur 5 catégories sans mélange", () => {
    const items: Item[] = [];
    for (let i = 0; i < 50; i++) {
      const cat = ["Bracelets", "Boucles d'oreilles", "Colliers", "Bagues", "Accessoires"][i % 5];
      items.push(make(`i${i}`, 1, `Produit ${i}`, `REF-${i}`, cat, null, 10));
    }
    const g = groupByCategory(items);
    expect(Object.keys(g).length).toBe(5);
    for (const cat of Object.keys(g)) {
      expect(g[cat].length).toBe(10);
    }
  });
});

describe("Panier v6 — subtotal & progression min order", () => {
  it("calcule le sous-total sans remise", () => {
    const items: Item[] = [
      make("a", 2, "P", "R", "C", null, 100),  // 200
      make("b", 3, "P", "R", "C", null, 50),   // 150
    ];
    expect(computeSubtotal(items)).toBeCloseTo(350, 2);
  });

  it("calcule le sous-total avec remise APPROVED", () => {
    const items: Item[] = [
      make("a", 2, "P", "R", "C", null, 100, 10),  // (100 * 0.9) * 2 = 180
      make("b", 3, "P", "R", "C", null, 50, 20),   // (50 * 0.8) * 3 = 120
    ];
    expect(computeSubtotal(items)).toBeCloseTo(300, 2);
  });

  it("calcule le nombre total d'unités (UNIT + PACK)", () => {
    const items: Item[] = [
      make("a", 2, "P", "R", "C", null, 10, null, "UNIT", null),      // 2
      make("b", 3, "P", "R", "C", null, 10, null, "PACK", 12),        // 36
      make("c", 1, "P", "R", "C", null, 10, null, "PACK", 6),         // 6
    ];
    expect(computeTotalUnits(items)).toBe(44);
  });

  it("progression min order : 456,50 € sur 500 € → 91,3 %", () => {
    const subtotal = 456.5;
    const minOrder = 500;
    const progress = Math.min(100, (subtotal / minOrder) * 100);
    expect(progress).toBeCloseTo(91.3, 1);
    expect(subtotal >= minOrder).toBe(false);
  });

  it("progression min order : dépassement → cap à 100 % + reached true", () => {
    const subtotal = 2704.65;
    const minOrder = 500;
    const progress = Math.min(100, (subtotal / minOrder) * 100);
    expect(progress).toBe(100);
    expect(subtotal >= minOrder).toBe(true);
  });

  it("pas de min order (0) → toujours atteint", () => {
    const subtotal = 100;
    const minOrder = 0;
    const reached = minOrder <= 0 || subtotal >= minOrder;
    expect(reached).toBe(true);
  });
});

describe("Panier v6 — filtrage + groupement combinés (cas 50 articles)", () => {
  it("recherche 'bracelet' sur 50 articles retourne uniquement la catégorie Bracelets", () => {
    const items: Item[] = [];
    for (let i = 0; i < 10; i++) items.push(make(`br${i}`, 1, `Bracelet ${i}`, `BR-${i}`, "Bracelets", null, 10));
    for (let i = 0; i < 10; i++) items.push(make(`bo${i}`, 1, `Créole ${i}`, `BO-${i}`, "Boucles d'oreilles", null, 10));
    for (let i = 0; i < 30; i++) items.push(make(`co${i}`, 1, `Collier ${i}`, `COL-${i}`, "Colliers", null, 10));

    const filtered = filterItems(items, "bracelet");
    const grouped = groupByCategory(filtered);

    expect(filtered.length).toBe(10);
    expect(Object.keys(grouped)).toEqual(["Bracelets"]);
    expect(grouped["Bracelets"].length).toBe(10);
  });
});
