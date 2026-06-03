/**
 * Excel generator for Efashion.
 *
 * Output : feuille « Template », 19 colonnes, 1 ligne par produit (toutes
 * couleurs et tailles concaténées). Max 60 lignes par fichier. Un produit
 * n'est jamais coupé entre deux fichiers (1 produit = 1 ligne donc trivial).
 *
 * Référence colonnes (modèle Efashion officiel) :
 *  1. Marque
 *  2. Référence
 *  3. Catégorie
 *  4. Sous catégorie
 *  5. Sous-sous Catégorie
 *  6. Provenances
 *  7. Vendu Par
 *  8. Qte min
 *  9. Collection
 * 10. Tailles  ("1*TU" ou "6*3A,12*4A,12*6A")
 * 11. Couleurs ("Doré, Argent")
 * 12. Prix HT
 * 13. Prix réduit HT
 * 14. Poids KG
 * 15. Compositions ("Acier*100")
 * 16. Description (fr)
 * 17. Description (en)
 * 18. Instructions pour shooting
 * 19. dimensions
 *
 * Quand un produit a plusieurs variantes (UNIT + PACK), on exporte la première
 * variante PACK trouvée sinon la première variante. Couleurs : union de toutes
 * les couleurs des variantes (sans doublons).
 */

import ExcelJS from "exceljs";
import type { ExportProduct, ExportContext, MarketplaceKey, ExportVariant } from "./types";
import { MARKETPLACE_LIMITS } from "./types";
import {
  formatCompositionEfashion,
  formatSizesQty,
  pickTranslation,
  variantUnitPriceWithMarkup,
} from "./format-helpers";

const EFASHION_HEADERS = [
  "Marque",
  "Référence",
  "Catégorie",
  "Sous catégorie",
  "Sous-sous Catégorie",
  "Provenances",
  "Vendu Par",
  "Qte min",
  "Collection",
  "Tailles",
  "Couleurs",
  "Prix HT",
  "Prix réduit HT",
  "Poids KG",
  "Compositions",
  "Description",
  "Description (en)",
  "Instructions pour shooting",
  "dimensions",
] as const;

type Row = (string | number)[];

const EFASHION_MARKETPLACE: MarketplaceKey = "efashion";

/**
 * Choose the canonical variant for an Efashion row : la **première variante
 * UNIT** (les PACK sont exclus de l'export Efashion).
 */
function pickEfashionVariant(p: ExportProduct): ExportVariant | null {
  const unit = p.variants.find((v) => v.saleType === "UNIT");
  return unit ?? null;
}

/** Build the comma-separated colors list, deduplicated across UNIT variants only. */
function efashionColorsField(p: ExportProduct): string {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const v of p.variants) {
    if (v.saleType !== "UNIT") continue;
    for (const c of v.colorNames) {
      if (!seen.has(c)) {
        seen.add(c);
        out.push(c);
      }
    }
  }
  return out.join(", ");
}

/** Build a single Efashion row for one product. */
export function productToEfashionRow(p: ExportProduct, ctx: ExportContext): Row {
  const v = pickEfashionVariant(p);
  if (!v) {
    throw new Error(
      `Produit ${p.reference} sans variante à l'unité — non exportable Efashion (les packs sont exclus).`,
    );
  }

  const cat = p.efashionCategoryPath;
  const markup = ctx.markups.efashion;
  const prixHT = variantUnitPriceWithMarkup(v, markup);

  // Format tailles Efashion : on utilise la référence courte (`pfsSizeRef` =
  // "TU" / "S" / "3A"...) plutôt que le libellé long en BDD ("Taille unique").
  // PFS et Efashion partagent en pratique le même format court.
  const tailles = formatSizesQty(v.sizes, ",", true);

  const dims = [
    p.dimensionLength,
    p.dimensionWidth,
    p.dimensionHeight,
    p.dimensionDiameter,
    p.dimensionCircumference,
  ]
    .filter((x): x is number => x != null)
    .join(" × ");

  return [
    ctx.shopName, // 1. Marque
    p.reference, // 2. Référence
    cat?.top || "", // 3. Catégorie
    cat?.sub || "", // 4. Sous catégorie
    cat?.leaf || p.categoryName || "", // 5. Sous-sous Catégorie
    p.manufacturingCountryName || "", // 6. Provenances
    "Couleurs", // 7. Vendu Par (fixe selon la cliente)
    "", // 8. Qte min
    p.seasonEfashionLabel || p.seasonName || "", // 9. Collection — libellé eFashion (mapping) si dispo, sinon nom local
    tailles, // 10. Tailles
    efashionColorsField(p), // 11. Couleurs
    prixHT, // 12. Prix HT
    "", // 13. Prix réduit HT
    v.weight, // 14. Poids KG
    formatCompositionEfashion(p), // 15. Compositions
    pickTranslation(p, "fr", "description"), // 16. Description
    pickTranslation(p, "en", "description"), // 17. Description (en)
    "", // 18. Instructions pour shooting
    dims, // 19. dimensions
  ];
}

/** Split products into batches of `limit` (default 60), preserving 1-row-per-product. */
export function batchProductsForEfashion(
  products: ExportProduct[],
  limit: number = MARKETPLACE_LIMITS[EFASHION_MARKETPLACE] ?? 60,
): ExportProduct[][] {
  const batches: ExportProduct[][] = [];
  for (let i = 0; i < products.length; i += limit) {
    batches.push(products.slice(i, i + limit));
  }
  return batches;
}

export async function generateEfashionExcelFiles(
  products: ExportProduct[],
  ctx: ExportContext,
): Promise<{ filename: string; buffer: Buffer }[]> {
  if (products.length === 0) return [];
  const batches = batchProductsForEfashion(products);

  const files: { filename: string; buffer: Buffer }[] = [];
  for (let i = 0; i < batches.length; i++) {
    const batch = batches[i]!;
    const wb = new ExcelJS.Workbook();
    const sheet = wb.addWorksheet("Template");

    sheet.addRow([...EFASHION_HEADERS]);
    sheet.getRow(1).font = { bold: true };

    for (const p of batch) {
      sheet.addRow(productToEfashionRow(p, ctx));
    }

    sheet.columns.forEach((col) => {
      col.width = 18;
    });

    const buf = await wb.xlsx.writeBuffer();
    const suffix =
      batches.length > 1 ? `_part-${i + 1}-sur-${batches.length}` : "";
    files.push({
      filename: `efashion${suffix}.xlsx`,
      buffer: Buffer.from(buf),
    });
  }

  return files;
}
