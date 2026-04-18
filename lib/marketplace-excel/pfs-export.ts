/**
 * PFS Excel export — loads the official "Modèle PFS.xlsx" template from
 * `lib/marketplace-excel/templates/pfs-template.xlsx` and fills the "Données"
 * sheet starting at row 2 (row 1 = headers, preserved). All ANNEXE sheets
 * (Catégories, Tailles v2, Pays v2, Couleurs, GenreFamilleCatégorie, Exemples)
 * are preserved so dropdowns and validations remain intact when PFS imports.
 *
 * "Données" sheet column order (27 cols):
 *   1 Marque, 2 Genre, 3 Famille, 4 Catégorie, 5 Réf, 6-10 Nom FR/EN/ES/DE/IT,
 *   11 Type vente, 12 Saison, 13 Tailles, 14 Couleurs, 15 Prix gros HT,
 *   16 Prix réduit HT, 17 Stock, 18 Poids kg/pc, 19 Composition Matière,
 *   20 Composition Doublure, 21 Pays, 22 Suffixe SKU, 23-27 Description FR/EN/ES/DE/IT
 *
 * One row per (product × saleType). A product with both UNIT and PACK variants
 * emits two rows. Sizes are encoded as "qty*size, qty*size" and colors as
 * comma-separated names.
 */

import path from "node:path";
import ExcelJS from "exceljs";
import { applyMarketplaceMarkup } from "@/lib/marketplace-pricing";
import { pfsGenderLabel } from "./pfs-taxonomy";
import type { ExportContext, ExportProduct, ExportVariant, SaleTypeKey } from "./types";

const TEMPLATE_PATH = path.join(process.cwd(), "lib", "marketplace-excel", "templates", "pfs-template.xlsx");
const DATA_SHEET_NAME = "Données";

function formatSizes(variant: ExportVariant): string {
  // Per-line sizes for PACK (fallback to variant.sizes if line has none)
  if (variant.saleType === "PACK" && variant.packColorLines.length > 0) {
    const parts: string[] = [];
    for (const line of variant.packColorLines) {
      const srcSizes = line.sizes.length > 0 ? line.sizes : variant.sizes;
      for (const s of srcSizes) parts.push(`${s.quantity}*${s.name}`);
    }
    if (parts.length > 0) return parts.join(", ");
  }
  return variant.sizes.map((s) => `${s.quantity}*${s.name}`).join(", ");
}

function formatColors(variant: ExportVariant): string {
  if (variant.saleType === "UNIT") {
    return [...variant.colorNames, ...variant.subColorNames].join(", ");
  }
  // PACK: first pack line's color composition (PFS expects a single set of colors per row)
  const first = variant.packColorLines[0];
  return first ? first.colors.join(", ") : "";
}

function formatComposition(product: ExportProduct): string {
  if (product.compositions.length === 0) return "";
  return product.compositions
    .map((c) => `${c.percentage}% ${c.name}`)
    .join(" - ");
}

function pfsTypeLabel(saleType: SaleTypeKey): string {
  return saleType === "UNIT" ? "Unité" : "Pack";
}

/**
 * Compute PFS wholesale HT price from DB `unitPrice`.
 * - UNIT: unitPrice is the per-unit price → apply markup.
 * - PACK: unitPrice is the total pack price → divide by packQuantity first,
 *   apply markup to per-unit price (matches existing pricing logic).
 */
function pfsUnitPrice(variant: ExportVariant, ctx: ExportContext): number {
  let base = variant.unitPrice;
  if (variant.saleType === "PACK" && variant.packQuantity && variant.packQuantity > 0) {
    base = variant.unitPrice / variant.packQuantity;
  }
  return applyMarketplaceMarkup(base, ctx.markups.pfs);
}

/**
 * One ExportProduct can emit 1 or 2 rows (UNIT and/or PACK).
 * We pick the first variant of each saleType as the "canonical" one for that row.
 */
function rowsForProduct(p: ExportProduct, ctx: ExportContext): (string | number)[][] {
  const rows: (string | number)[][] = [];
  const saleTypes: SaleTypeKey[] = [];
  if (p.variants.some((v) => v.saleType === "UNIT")) saleTypes.push("UNIT");
  if (p.variants.some((v) => v.saleType === "PACK")) saleTypes.push("PACK");

  const brand = ctx.shopName;
  const gender = pfsGenderLabel(p.pfsGenderCode);
  const family = p.pfsFamilyName ?? "";
  const category = p.categoryName;
  const season = p.seasonPfsRef ?? "";
  const country = p.manufacturingCountryName ?? "";
  const composition = formatComposition(p);
  const descFr = p.description;
  const nameEn = p.translations["en"]?.name ?? "";
  const nameEs = p.translations["es"]?.name ?? "";
  const nameDe = p.translations["de"]?.name ?? "";
  const nameIt = p.translations["it"]?.name ?? "";
  const descEn = p.translations["en"]?.description ?? "";
  const descEs = p.translations["es"]?.description ?? "";
  const descDe = p.translations["de"]?.description ?? "";
  const descIt = p.translations["it"]?.description ?? "";

  for (const saleType of saleTypes) {
    // Merge all variants of this saleType into one row (combined sizes/colors/stock)
    const group = p.variants.filter((v) => v.saleType === saleType);
    if (group.length === 0) continue;

    // Combine: unique sizes+qty across variants, all color compositions joined
    const sizeParts = new Set<string>();
    const colorParts = new Set<string>();
    let totalStock = 0;
    let firstVariant = group[0];

    for (const v of group) {
      totalStock += v.stock;
      const sz = formatSizes(v);
      if (sz) sizeParts.add(sz);
      const cl = formatColors(v);
      if (cl) colorParts.add(cl);
    }

    // Pack quantity multiplier for stock display
    const stockPcs = saleType === "PACK" && firstVariant.packQuantity
      ? totalStock * firstVariant.packQuantity
      : totalStock;

    rows.push([
      brand,
      gender,
      family,
      category,
      p.reference,
      p.name,
      nameEn,
      nameEs,
      nameDe,
      nameIt,
      pfsTypeLabel(saleType),
      season,
      Array.from(sizeParts).join(", "),
      Array.from(colorParts).join(", "),
      Number(pfsUnitPrice(firstVariant, ctx).toFixed(2)),
      "", // Prix réduit — not exported (admin sets PFS discount manually)
      stockPcs,
      firstVariant.weight,
      composition,
      "", // Doublure
      country,
      "", // Suffixe SKU
      descFr,
      descEn,
      descEs,
      descDe,
      descIt,
    ]);
  }

  return rows;
}

interface PfsExportWarning {
  reference: string;
  message: string;
}

/**
 * Remove every data row from "Données" so we start fresh at row 2 while
 * preserving the header (row 1) and all other sheets (ANNEXE, Exemples…).
 * Splicing from the bottom avoids renumbering issues.
 */
function clearDataRows(ws: ExcelJS.Worksheet): void {
  const lastRow = ws.rowCount;
  if (lastRow <= 1) return;
  for (let r = lastRow; r >= 2; r--) {
    ws.spliceRows(r, 1);
  }
}

export async function buildPfsWorkbook(
  products: ExportProduct[],
  ctx: ExportContext,
): Promise<{ buffer: Buffer; warnings: PfsExportWarning[] }> {
  const warnings: PfsExportWarning[] = [];
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(TEMPLATE_PATH);

  const ws = wb.getWorksheet(DATA_SHEET_NAME);
  if (!ws) {
    throw new Error(`Feuille "${DATA_SHEET_NAME}" introuvable dans le modèle PFS.`);
  }
  clearDataRows(ws);

  for (const p of products) {
    if (!p.pfsGenderCode) warnings.push({ reference: p.reference, message: "Genre PFS manquant — renseigner dans /admin/pfs/correspondances (onglet Catégories)" });
    if (!p.pfsFamilyName) warnings.push({ reference: p.reference, message: "Famille PFS manquante — renseigner dans /admin/pfs/correspondances (onglet Catégories)" });
    if (!p.seasonPfsRef) warnings.push({ reference: p.reference, message: "Saison PFS manquante — renseigner dans /admin/pfs/correspondances (onglet Saisons)" });
    if (!ctx.shopName) warnings.push({ reference: p.reference, message: "Nom de la boutique manquant — renseigner CompanyInfo.shopName" });

    const rows = rowsForProduct(p, ctx);
    for (const row of rows) ws.addRow(row);
  }

  const buffer = Buffer.from(await wb.xlsx.writeBuffer());
  return { buffer, warnings };
}
