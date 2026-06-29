/**
 * Excel generator for Microstore.
 *
 * Output : feuille « Worksheet », 17 colonnes, 1 ligne par couleur unique du
 * produit (toutes variantes confondues). Pas de limite par fichier.
 *
 * Référence colonnes (modèle Microstore officiel) :
 *  1. Référence
 *  2. Nom
 *  3. Catégorie
 *  4. Contenu colis  (toujours 1)
 *  5. Composition matérielle
 *  6. Marque
 *  7. Année  (année courante via new Date().getFullYear())
 *  8. Saison
 *  9. Colisage  (toujours 1)
 * 10. Couleur
 * 11. Stock
 * 12. Nbr de pièces hors unité de colisage  (0)
 * 13. Poids (en gramme)
 * 14. Prix
 * 15. Pays d'origine
 * 16. Remise (%)
 * 17. Remarque  (description courte FR)
 */

import ExcelJS from "exceljs";
import type { ExportProduct, ExportContext, ExportVariant } from "./types";
import {
  formatCompositionPfs,
  pickTranslation,
  variantUnitPriceWithMarkup,
} from "./format-helpers";

const MICROSTORE_HEADERS = [
  "Référence",
  "Nom",
  "Catégorie",
  "Contenu colis",
  "Composition matérielle",
  "Marque",
  "Année",
  "Saison",
  "Colisage",
  "Couleur",
  "Stock",
  "Nbr de pièces hors unité de colisage",
  "Poids (en gramme)",
  "Prix",
  "Pays d'origine",
  "Remise (%)",
  "Remarque",
] as const;

type Row = (string | number)[];

interface ColorBucket {
  colorName: string;
  /** Variante "représentative" pour cette couleur (prix, poids, stock). */
  variant: ExportVariant;
}

/**
 * For each unique color of a product (UNIT variants only — les PACK sont
 * exclus de l'export Microstore), find the variant that represents it
 * (the first UNIT variant containing this color name).
 */
export function bucketByColor(p: ExportProduct): ColorBucket[] {
  const buckets = new Map<string, ColorBucket>();
  for (const v of p.variants) {
    if (v.saleType !== "UNIT") continue;
    for (const colorName of v.colorNames) {
      if (!buckets.has(colorName)) {
        buckets.set(colorName, { colorName, variant: v });
      }
    }
  }
  return [...buckets.values()];
}

/** Build Microstore rows (1 per color) for one product. */
export function productToMicrostoreRows(
  p: ExportProduct,
  ctx: ExportContext,
  year: number = new Date().getFullYear(),
): Row[] {
  const markup = ctx.markups.microstore;
  const composition = formatCompositionPfs(p);
  const remarque = pickTranslation(p, "fr", "description");

  return bucketByColor(p).map((b): Row => {
    const v = b.variant;
    const prix = variantUnitPriceWithMarkup(v, markup);
    const poidsGrammes = Math.round(Number(v.weight) * 1000);

    // Colonne « Catégorie » : si la cliente a choisi une sous-catégorie comme
    // étiquette Microstore (radio dans la page produit), on l'utilise. Sinon
    // on prend la catégorie du site (jamais la catégorie PFS).
    const categoryLabel =
      p.microstoreCategoryOverride || p.categoryName || "";

    return [
      p.reference, // 1. Référence
      pickTranslation(p, "fr", "name"), // 2. Nom
      categoryLabel, // 3. Catégorie
      1, // 4. Contenu colis (fixe)
      composition, // 5. Composition matérielle
      ctx.shopName, // 6. Marque
      year, // 7. Année
      p.seasonName || "Toutes saisons", // 8. Saison
      1, // 9. Colisage (fixe)
      b.colorName, // 10. Couleur
      v.stock, // 11. Stock
      0, // 12. Nbr pièces hors unité colisage
      poidsGrammes, // 13. Poids (en gramme)
      prix, // 14. Prix
      p.manufacturingCountryName || "", // 15. Pays d'origine
      "", // 16. Remise (%)
      remarque, // 17. Remarque
    ];
  });
}

export async function generateMicrostoreExcelFiles(
  products: ExportProduct[],
  ctx: ExportContext,
): Promise<{ filename: string; buffer: Buffer }[]> {
  if (products.length === 0) return [];

  const wb = new ExcelJS.Workbook();
  const sheet = wb.addWorksheet("Worksheet");

  sheet.addRow([...MICROSTORE_HEADERS]);
  sheet.getRow(1).font = { bold: true };

  for (const p of products) {
    for (const row of productToMicrostoreRows(p, ctx)) {
      sheet.addRow(row);
    }
  }

  sheet.columns.forEach((col) => {
    col.width = 18;
  });

  const buf = await wb.xlsx.writeBuffer();
  return [
    {
      filename: "microstore.xlsx",
      buffer: Buffer.from(buf),
    },
  ];
}
