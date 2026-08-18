/**
 * lib/low-stock-report.ts
 *
 * Sélectionne les produits dont au moins une variante (ProductColor) a un
 * stock faible : soit rupture (stock === 0), soit presque rupture (stock < 10).
 *
 * Utilisé par la route /api/admin/products/low-stock-pdf pour générer un
 * rapport imprimable (1 page par produit).
 */

export const LOW_STOCK_THRESHOLD = 10;

export type LowStockLevel = "out" | "low";

export function classifyStock(stock: number): LowStockLevel | null {
  if (stock <= 0) return "out";
  if (stock < LOW_STOCK_THRESHOLD) return "low";
  return null;
}

export interface ProductColorForReport {
  id:        string;
  colorId:   string | null;
  stock:     number;
  disabled:  boolean;
  color: {
    name:         string;
    hex:          string | null;
    patternImage: string | null;
  } | null;
  firstImagePath: string | null;
}

export interface ReportColor {
  colorId:        string;
  stock:          number;
  level:          LowStockLevel;
  color: {
    name:         string;
    hex:          string | null;
    patternImage: string | null;
  } | null;
  firstImagePath: string | null;
}

export interface ProductForReport {
  id:        string;
  reference: string;
  name:      string;
  category:  string | null;
  colors:    ReportColor[];
}

/**
 * Filtre les variantes en stock faible et regroupe par produit.
 * Ignore les variantes désactivées (elles ne sont plus vendues).
 *
 * Dédoublonnage : un même colorId peut apparaître dans plusieurs ProductColor
 * (ex : une variante UNIT + une variante PACK de la même couleur, ou plusieurs
 * PACK multi-couleurs partageant une couleur). On agrège en sommant les stocks
 * pour n'afficher qu'UNE ligne par couleur dans le PDF.
 *
 * Le produit n'apparaît que si au moins une couleur agrégée est en alerte.
 */
export function selectLowStockProducts<TProduct extends {
  id:        string;
  reference: string;
  name:      string;
  category?: { name: string } | null;
  colors:    ProductColorForReport[];
}>(products: TProduct[]): ProductForReport[] {
  const out: ProductForReport[] = [];

  for (const p of products) {
    // 1) Agrégation : somme des stocks des ProductColor actives partageant le
    //    même colorId. Les métadonnées (color info + firstImagePath) sont
    //    identiques entre ProductColor d'une même couleur, on garde la 1re non-null.
    const byColor = new Map<string, ReportColor>();
    for (const c of p.colors) {
      if (c.disabled) continue;
      if (!c.colorId) continue;
      const existing = byColor.get(c.colorId);
      if (existing) {
        existing.stock += c.stock;
        existing.firstImagePath ??= c.firstImagePath;
      } else {
        byColor.set(c.colorId, {
          colorId:        c.colorId,
          stock:          c.stock,
          level:          "low", // recalculé après somme
          color:          c.color,
          firstImagePath: c.firstImagePath,
        });
      }
    }

    // 2) Classification sur le stock TOTAL de la couleur.
    const lowColors: ReportColor[] = [];
    for (const rc of byColor.values()) {
      const level = classifyStock(rc.stock);
      if (level) lowColors.push({ ...rc, level });
    }
    if (lowColors.length === 0) continue;

    // 3) Tri : ruptures d'abord, puis stock croissant, puis nom couleur.
    lowColors.sort((a, b) => {
      if (a.level !== b.level) return a.level === "out" ? -1 : 1;
      if (a.stock !== b.stock) return a.stock - b.stock;
      return (a.color?.name ?? "").localeCompare(b.color?.name ?? "");
    });

    out.push({
      id:        p.id,
      reference: p.reference,
      name:      p.name,
      category:  p.category?.name ?? null,
      colors:    lowColors,
    });
  }

  // Tri produits : ceux avec le plus de ruptures d'abord, puis par référence.
  out.sort((a, b) => {
    const outA = a.colors.filter((c) => c.level === "out").length;
    const outB = b.colors.filter((c) => c.level === "out").length;
    if (outA !== outB) return outB - outA;
    return a.reference.localeCompare(b.reference);
  });

  return out;
}
