/**
 * Excel generator for Paris Fashion Shop.
 *
 * Output : feuille « Données », 27 colonnes, 1 ligne par variante (UNIT et PACK
 * séparés). Max 500 lignes par fichier — un produit n'est jamais coupé entre
 * deux fichiers (si l'ajout dépasse, on passe au fichier suivant en entier).
 *
 * Référence colonnes (telles que dans le modèle PFS officiel) :
 *  1. Marque
 *  2. Genre
 *  3. Famille
 *  4. Catégorie
 *  5. Réf. Produit
 *  6. Nom du produit (fr)
 *  7. Nom du produit (en)
 *  8. Nom du produit (es)
 *  9. Nom du produit (de)
 * 10. Nom du produit (it)
 * 11. Unité/Pack
 * 12. Saison
 * 13. Tailles ("1*TU" ou "12*TU")
 * 14. Couleurs ("Doré, Argent")
 * 15. Prix HT
 * 16. Prix vente réduit HT
 * 17. Quantité total stock pcs
 * 18. Poids_Kg / pc
 * 19. Composition Matière
 * 20. Composition Doublure
 * 21. Pays origine
 * 22. Suffixe SKU
 * 23. Description (FR)
 * 24. Description (EN)
 * 25. Description (ES)
 * 26. Description (DE)
 * 27. Description (IT)
 */

import ExcelJS from "exceljs";
import type { ExportProduct, ExportContext, MarketplaceKey } from "./types";
import { MARKETPLACE_LIMITS } from "./types";
import {
  formatColorList,
  formatCompositionPfs,
  formatSizesQty,
  pickTranslation,
  variantUnitPriceWithMarkup,
} from "./format-helpers";

const PFS_HEADERS = [
  "Marque",
  "Genre*",
  "Famille*",
  "Catégorie*",
  "Réf. Produit*",
  "Nom du produit (fr)*",
  "Nom du produit (en)",
  "Nom du produit (es)",
  "Nom du produit (de)",
  "Nom du produit (it)",
  "Unité/Pack*",
  "Saison*",
  "Tailles*",
  "Couleurs*",
  "Prix HT*",
  "Prix vente réduit HT",
  "Quantité total stock pcs",
  "Poids_Kg / pc*",
  "Composition Matière*",
  "Composition Doublure",
  "Pays origine*",
  "Suffixe SKU",
  "Description (FR)*",
  "Description (EN)",
  "Description (ES)",
  "Description (DE)",
  "Description (IT)",
] as const;

type Row = (string | number)[];

const PFS_MARKETPLACE: MarketplaceKey = "pfs";

/**
 * Expand 1 product to N rows (1 per variant) following the PFS template.
 */
export function productToPfsRows(p: ExportProduct, ctx: ExportContext): Row[] {
  const markup = ctx.markups.pfs;
  return p.variants.map((v) => {
    const isPack = v.saleType === "PACK";
    const saleLabel = isPack ? "Pack" : "Unité";

    // Tailles : "<qty>*<sizeRef|name>" séparés par ", ".
    // Pour PACK mono-couleur, on agrège déjà les sizes côté load-products.
    const tailles = formatSizesQty(v.sizes, ", ", true);

    const couleurs = formatColorList(v);
    const compositionMatiere = formatCompositionPfs(p);

    const prixHT = variantUnitPriceWithMarkup(v, markup);
    // Stock exporté tel qu'affiché dans l'admin — pas de multiplication par
    // la taille du pack. La cliente gère son stock en "packs" (ou en unités)
    // et veut voir la même valeur côté marketplace (décision 2026-06-06).
    const stockPcs = v.stock;

    return [
      ctx.shopName, // 1. Marque
      p.pfsGenderCode === "WOMAN"
        ? "Femme"
        : p.pfsGenderCode === "MAN"
          ? "Homme"
          : p.pfsGenderCode === "KID"
            ? "Enfant"
            : p.pfsGenderCode === "SUPPLIES"
              ? "Lifestyle_et_Plus"
              : "", // 2. Genre
      p.pfsFamilyName || "", // 3. Famille
      p.pfsCategoryName || p.categoryName || "", // 4. Catégorie
      p.reference, // 5. Réf. Produit
      pickTranslation(p, "fr", "name"), // 6. Nom FR
      pickTranslation(p, "en", "name"), // 7. Nom EN
      pickTranslation(p, "es", "name"), // 8. Nom ES
      pickTranslation(p, "de", "name"), // 9. Nom DE
      pickTranslation(p, "it", "name"), // 10. Nom IT
      saleLabel, // 11. Unité/Pack
      p.seasonPfsRef || "", // 12. Saison
      tailles, // 13. Tailles
      couleurs, // 14. Couleurs
      prixHT, // 15. Prix HT
      "", // 16. Prix vente réduit HT (vide par défaut)
      stockPcs, // 17. Quantité total stock pcs
      v.weight, // 18. Poids_Kg / pc
      compositionMatiere, // 19. Composition Matière
      "", // 20. Composition Doublure (vide)
      p.manufacturingCountryName || "", // 21. Pays origine
      v.sku || "", // 22. Suffixe SKU
      pickTranslation(p, "fr", "description"), // 23. Description FR
      pickTranslation(p, "en", "description"), // 24. Description EN
      pickTranslation(p, "es", "description"), // 25. Description ES
      pickTranslation(p, "de", "description"), // 26. Description DE
      pickTranslation(p, "it", "description"), // 27. Description IT
    ];
  });
}

/**
 * Split a list of products into batches that fit within the PFS row limit,
 * without ever splitting a product across two batches.
 *
 * Throws if a single product expands to more rows than the limit.
 */
export function batchProductsForPfs(
  products: ExportProduct[],
  limit: number = MARKETPLACE_LIMITS[PFS_MARKETPLACE] ?? 500,
): ExportProduct[][] {
  const batches: ExportProduct[][] = [[]];
  let currentRows = 0;

  for (const p of products) {
    const rows = p.variants.length;
    if (rows > limit) {
      throw new Error(
        `Produit ${p.reference} a ${rows} variantes, supérieur à la limite PFS de ${limit} lignes par fichier.`,
      );
    }
    if (currentRows + rows > limit && batches[batches.length - 1]!.length > 0) {
      batches.push([]);
      currentRows = 0;
    }
    batches[batches.length - 1]!.push(p);
    currentRows += rows;
  }

  return batches.filter((b) => b.length > 0);
}

/**
 * Generate one or more PFS Excel files (Buffer) for the given products.
 * If `products.length` is 0, returns an empty array.
 */
export async function generatePfsExcelFiles(
  products: ExportProduct[],
  ctx: ExportContext,
): Promise<{ filename: string; buffer: Buffer }[]> {
  if (products.length === 0) return [];
  const batches = batchProductsForPfs(products);

  const files: { filename: string; buffer: Buffer }[] = [];
  for (let i = 0; i < batches.length; i++) {
    const batch = batches[i]!;
    const wb = new ExcelJS.Workbook();
    const sheet = wb.addWorksheet("Données");

    // En-tête
    sheet.addRow([...PFS_HEADERS]);
    sheet.getRow(1).font = { bold: true };

    // Data rows
    for (const p of batch) {
      for (const row of productToPfsRows(p, ctx)) {
        sheet.addRow(row);
      }
    }

    // Largeur colonnes par défaut
    sheet.columns.forEach((col) => {
      col.width = 18;
    });

    const buf = await wb.xlsx.writeBuffer();
    const suffix =
      batches.length > 1 ? `_part-${i + 1}-sur-${batches.length}` : "";
    files.push({
      filename: `paris-fashion-shop${suffix}.xlsx`,
      buffer: Buffer.from(buf),
    });
  }

  return files;
}
