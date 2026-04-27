/**
 * Ankorstore Excel export — loads the official "Modèle Ankorstore.xlsx" template
 * from `lib/marketplace-excel/templates/ankorstore-template.xlsx` and fills the
 * "Vos produits" sheet starting at row 2 (row 1 = headers, preserved). Other
 * sheets (LISEZ-MOI, Exemples, Codes pays) are preserved so the uploaded file
 * matches what Ankorstore ships.
 *
 * "Vos produits" sheet layout (45 columns). One row per variant (unique SKU):
 *   1 SKU, 2 Nom produit, 3 Description (min 30 chars — only on first variant),
 *   4 Taille, 5 Couleur, 6 Autres attributs,
 *   7 Image variante (per variant — Ankorstore caps variant thumbnails to 1),
 *   8-12 Image produit 1-5 (product-level gallery, only on first variant row;
 *     aggregates unique image URLs from all variants, up to 5),
 *   13 Prix gros HT, 14 Prix détail TTC, 15 TVA %, 16 Remise %, 17 Unités/paquet,
 *   18 Stock, 19 Pays ISO2, 20 Code douanier, 21 EAN,
 *   22-25 Dim unité+LWH, 26-27 Poids unité+valeur, 28-29 Volume unité+valeur,
 *   30 Composition, 31 INCI, 32 Matériau, 33 Ingrédients, 34 DLC, 35 DDM,
 *   36-45 booleans (X/vide): bestseller, alcool, cruelty-free, eco, refrigerated,
 *     frozen, handmade, organic, vegan, zero-waste.
 *
 * Retail TTC = wholesale HT with wholesale markup, then retail markup, then add VAT.
 * PACK: markup applied to per-unit price (total / packQty), then retail × (1+VAT).
 * Image URLs are built from the site's public base URL + DB image path.
 */

import path from "node:path";
import ExcelJS from "exceljs";
import { applyMarketplaceMarkup } from "@/lib/marketplace-pricing";
import {
  ANKORSTORE_DESCRIPTION_MIN_CHARS,
  composeAnkorstoreDescription,
} from "@/lib/ankorstore-description";
import type { ExportContext, ExportProduct, ExportVariant } from "./types";

const TEMPLATE_PATH = path.join(process.cwd(), "lib", "marketplace-excel", "templates", "ankorstore-template.xlsx");
const DATA_SHEET_NAME = "Vos produits";

function variantColorLabel(v: ExportVariant): string {
  return [...v.colorNames, ...v.subColorNames].join(" / ");
}

function variantSizeLabel(v: ExportVariant): string {
  if (v.sizes.length === 0) return "";
  return v.sizes.map((s) => s.quantity > 1 ? `${s.quantity}*${s.name}` : s.name).join(", ");
}

function variantImageUrls(v: ExportVariant, ctx: ExportContext): string[] {
  const base = ctx.publicBaseUrl;
  return v.imagePaths.map((p) => {
    const clean = p.startsWith("/") ? p.slice(1) : p;
    return base ? `${base}/${clean}` : `/${clean}`;
  });
}

/**
 * Build the product-level gallery (Ankorstore columns "Image 1-5") by walking
 * every variant in order and collecting unique image URLs, capped at 5.
 */
function productGalleryUrls(p: ExportProduct, ctx: ExportContext): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const v of p.variants) {
    for (const url of variantImageUrls(v, ctx)) {
      if (!url || seen.has(url)) continue;
      seen.add(url);
      out.push(url);
      if (out.length === 5) return out;
    }
  }
  return out;
}

function variantSku(p: ExportProduct, v: ExportVariant, idx: number): string {
  if (v.sku) return v.sku;
  // Fallback: reference_colorLabel_saletype_index
  const color = variantColorLabel(v).replace(/\s+/g, "_") || "NA";
  return `${p.reference}_${color}_${v.saleType}_${idx + 1}`;
}

function formatCompositionShort(p: ExportProduct): string {
  if (p.compositions.length === 0) return "";
  return p.compositions.map((c) => `${c.percentage}% ${c.name}`).join(" - ");
}

/**
 * Wholesale HT per unit (with markup applied).
 */
function ankorstoreWholesaleHT(v: ExportVariant, ctx: ExportContext): number {
  let base = v.unitPrice;
  if (v.saleType === "PACK" && v.packQuantity && v.packQuantity > 0) {
    base = v.unitPrice / v.packQuantity;
  }
  return applyMarketplaceMarkup(base, ctx.markups.ankorstoreWholesale);
}

/**
 * Retail TTC per unit: wholesale_HT → apply retail markup → add VAT.
 */
function ankorstoreRetailTTC(v: ExportVariant, ctx: ExportContext): number {
  const wholesaleHT = ankorstoreWholesaleHT(v, ctx);
  const retailHT = applyMarketplaceMarkup(wholesaleHT, ctx.markups.ankorstoreRetail);
  const ttc = retailHT * (1 + ctx.ankorstoreVatRate / 100);
  return Math.round(ttc * 100) / 100;
}

interface AnkorstoreExportWarning {
  reference: string;
  message: string;
}

/**
 * Remove every data row from "Vos produits" so we start fresh at row 2 while
 * preserving the header (row 1) and all other sheets (LISEZ-MOI, Exemples, Codes pays).
 */
function clearDataRows(ws: ExcelJS.Worksheet): void {
  const lastRow = ws.rowCount;
  if (lastRow <= 1) return;
  for (let r = lastRow; r >= 2; r--) {
    ws.spliceRows(r, 1);
  }
}

export async function buildAnkorstoreWorkbook(
  products: ExportProduct[],
  ctx: ExportContext,
): Promise<{ buffer: Buffer; warnings: AnkorstoreExportWarning[] }> {
  const warnings: AnkorstoreExportWarning[] = [];
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(TEMPLATE_PATH);

  const ws = wb.getWorksheet(DATA_SHEET_NAME);
  if (!ws) {
    throw new Error(`Feuille "${DATA_SHEET_NAME}" introuvable dans le modèle Ankorstore.`);
  }
  clearDataRows(ws);

  for (const p of products) {
    if (!p.manufacturingCountryIso) {
      warnings.push({ reference: p.reference, message: "Code ISO2 du pays de fabrication manquant (ManufacturingCountry.isoCode)" });
    }

    const productName = p.name || p.reference;
    const description = composeAnkorstoreDescription(p.description, p.reference);
    if (description.length < ANKORSTORE_DESCRIPTION_MIN_CHARS) {
      warnings.push({ reference: p.reference, message: "Description < 30 caractères — Ankorstore exige 30 min" });
    }
    const composition = formatCompositionShort(p);
    const iso = p.manufacturingCountryIso ?? "";
    const gallery = productGalleryUrls(p, ctx);

    p.variants.forEach((v, idx) => {
      const sku = variantSku(p, v, idx);
      const variantThumb = variantImageUrls(v, ctx)[0] ?? "";
      const g1 = idx === 0 ? (gallery[0] ?? "") : "";
      const g2 = idx === 0 ? (gallery[1] ?? "") : "";
      const g3 = idx === 0 ? (gallery[2] ?? "") : "";
      const g4 = idx === 0 ? (gallery[3] ?? "") : "";
      const g5 = idx === 0 ? (gallery[4] ?? "") : "";
      const unitsPerPack = v.saleType === "PACK" && v.packQuantity ? v.packQuantity : 1;

      ws.addRow([
        sku,
        productName,
        idx === 0 ? description : "", // Description only on first variant
        variantSizeLabel(v),
        variantColorLabel(v),
        "", // Autres attributs
        variantThumb, // Image variante (1 per variant — Ankorstore rule)
        g1, // Image 1 (product gallery, first row only)
        g2,
        g3,
        g4,
        g5,
        Number(ankorstoreWholesaleHT(v, ctx).toFixed(2)),
        Number(ankorstoreRetailTTC(v, ctx).toFixed(2)),
        ctx.ankorstoreVatRate,
        "", // Remise %
        unitsPerPack,
        v.stock,
        iso,
        "", // Code douanier
        "", // EAN
        p.dimensionLength != null || p.dimensionWidth != null || p.dimensionHeight != null ? "mm" : "", // Unité dim
        p.dimensionLength ?? "", // Longueur
        p.dimensionWidth ?? "",  // Largeur
        p.dimensionHeight ?? "", // Hauteur
        "kg", // Unité poids
        v.weight,
        "", // Unité volume
        "", // Volume
        composition,
        "", // INCI
        "", // Matériau
        "", // Ingrédients
        "", "", // DLC, DDM
        "", "", "", "", "", "", "", "", "", "", // 10 booleans (all empty)
      ]);
    });
  }

  const buffer = Buffer.from(await wb.xlsx.writeBuffer());
  return { buffer, warnings };
}
