/**
 * Excel generator for Faire.
 *
 * Output : feuille « Produits|Français » du modèle officiel Faire, 68 colonnes,
 * 1 ligne par variante UNIT (les PACK ne partent pas vers Faire — choix cliente
 * 2026-06-27, aligné sur Ankorstore/Microstore/Efashion).
 *
 * Le modèle Faire contient 4 feuilles :
 *   1. Instructions
 *   2. Produits|Français          ← on remplit ici à partir de la ligne 4
 *   3. Définitions des colonnes
 *   4. Options de données         ← listes déroulantes pour Excel
 *
 * Les 3 premières lignes de la feuille « Produits|Français » sont les en-têtes
 * Faire (libellé FR, indication obligatoire/facultatif, code interne) — on les
 * conserve telles quelles. Les données commencent toujours à la ligne 4.
 *
 * Convention images : la colonne `product_images` accepte plusieurs URLs
 * séparées par UNE espace (cf. « Définitions des colonnes » ligne 48 :
 * « Cette cellule contiendra toutes vos images séparées par une espace »).
 *
 * Convention options : Beli & Jolie n'utilise qu'une seule dimension d'option
 * pour les UNIT (la couleur). On pose `option_1_name = "Couleur"` et la valeur
 * = nom de la couleur. Les options 2 et 3 restent vides.
 *
 * Prix : Faire impose retail = 1,25 à 10× wholesale ; `applyFaireMarkupWithClamp`
 * (cf. lib/marketplace-pricing-shared.ts) garantit ce ratio même si les markups
 * configurés par l'admin sortent de la fourchette.
 *
 * Code SH (douane) : Faire attend le format 6 chiffres « 7117.19 ». La BDD
 * stocke souvent un suffixe à 8 chiffres (« 7117.19.00 ») hérité du module
 * Ankorstore ; on tronque à « ####.## » avant export.
 */

import ExcelJS from "exceljs";
import path from "path";
import type { ExportProduct, ExportContext, ExportVariant } from "./types";
import { applyFaireMarkupWithClamp } from "@/lib/marketplace-pricing";
import { buildFaireImageUrl } from "@/lib/marketplace-image";
import { pickTranslation } from "./format-helpers";

const FAIRE_TEMPLATE_PATH = path.join(
  process.cwd(),
  "lib/marketplace-excel/templates/faire-template.xlsx",
);

const FAIRE_DATA_SHEET = "Produits|Français";
const FAIRE_DATA_START_ROW = 4;
const FAIRE_COLUMN_COUNT = 68;

type Row = (string | number | null)[];

/** Tronque un code SH BJ (souvent `XXXX.XX.XX`) au format Faire `XXXX.XX`. */
export function formatFaireTariffCode(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const cleaned = raw.trim();
  if (!cleaned) return null;
  const m = /^(\d{4}\.\d{2})/.exec(cleaned);
  return m ? m[1]! : cleaned;
}

/** Construit le SKU envoyé à Faire pour une variante UNIT : `<REF>_<COULEUR>`. */
export function faireSkuForVariant(
  reference: string,
  variant: ExportVariant,
  index: number,
): string {
  const colorPart = variant.colorNames
    .join(" ")
    .toLocaleUpperCase("fr-FR")
    .trim();
  if (colorPart) return `${reference}_${colorPart}`;
  return `${reference}_V${index + 1}`;
}

/** Liste des URLs Faire (proxy `?format=jpeg&minWidth=1000`) pour une variante,
 *  avec fallback sur les images d'une autre variante du même produit si la
 *  variante UNIT exportée n'a pas d'image propre (cas fréquent quand les
 *  photos studio vivent sur le PACK). Capé à 10. */
function variantImageUrls(
  variant: ExportVariant,
  baseUrl: string,
  productFallback: ExportVariant[],
): string[] {
  const source =
    variant.imagePaths.length > 0
      ? variant.imagePaths
      : (productFallback.find((v) => v.imagePaths.length > 0)?.imagePaths ?? []);
  return source.slice(0, 10).map((p) => buildFaireImageUrl(p, baseUrl));
}

/** Build N rows (1 per UNIT variant) for one product. */
export function productToFaireRows(
  p: ExportProduct,
  ctx: ExportContext,
): Row[] {
  const productName = (pickTranslation(p, "fr", "name") || p.name).slice(0, 60);
  const description = (pickTranslation(p, "fr", "description") || "").slice(0, 1000);
  const madeIn = p.manufacturingCountryName || "";
  const tariffCode = formatFaireTariffCode(p.hsCode);
  const wholesaleCfg = ctx.markups.faireWholesale;
  const retailCfg = ctx.markups.faireRetail;

  // PACK exclus de l'export Faire — choix cliente 2026-06-27.
  const unitVariants = p.variants.filter((v) => v.saleType === "UNIT");

  // Dimensions de l'article (mm en BDD → cm Faire, arrondi 1 décimale).
  const mmToCm = (mm: number | null) =>
    mm && mm > 0 ? Math.round((mm / 10) * 10) / 10 : null;
  const length = mmToCm(p.dimensionLength);
  const width = mmToCm(p.dimensionWidth);
  const height = mmToCm(p.dimensionHeight);
  const hasDims = length !== null || width !== null || height !== null;

  return unitVariants.map((v, i): Row => {
    const sku = faireSkuForVariant(p.reference, v, i);
    const colorValue = v.colorNames.join(", ");
    const images = variantImageUrls(v, ctx.publicBaseUrl, p.variants);
    const productImages = images.join(" ");

    // Faire impose retail = 1,25 à 10× wholesale ; le helper clampe au besoin.
    const { wholesale, retail } = applyFaireMarkupWithClamp(
      v.unitPrice,
      wholesaleCfg,
      retailCfg,
    );

    // Tableau 0-indexé aligné sur les 68 colonnes du modèle.
    const row: Row = new Array(FAIRE_COLUMN_COUNT).fill(null);

    row[0] = productName; // 1 product_name_french
    row[1] = "Publié"; // 2 info_status_v2
    row[2] = null; // 3 info_product_token — vide pour un nouveau produit
    row[3] = null; // 4 info_product_type — Faire le devine
    row[4] = description || null; // 5 product_description_french
    row[5] = "Par article"; // 6 selling_method (UNIT)
    row[6] = null; // 7 case_quantity
    row[7] = 1; // 8 minimum_order_quantity
    row[8] = v.weight > 0 ? Number(v.weight) : null; // 9 item_weight (kg)
    row[9] = v.weight > 0 ? "kg" : null; // 10 item_weight_unit
    row[10] = length; // 11 item_length (cm)
    row[11] = width; // 12 item_width (cm)
    row[12] = height; // 13 item_height (cm)
    row[13] = hasDims ? "cm" : null; // 14 item_dimensions_unit
    row[14] = null; // 15 packaged_weight
    row[15] = null; // 16 packaged_weight_unit
    row[16] = null; // 17 packaged_length
    row[17] = null; // 18 packaged_width
    row[18] = null; // 19 packaged_height
    row[19] = null; // 20 packaged_dimensions_unit
    row[20] = "Publié"; // 21 option_status
    row[21] = sku; // 22 sku
    row[22] = null; // 23 gtin
    row[23] = colorValue ? "Couleur" : null; // 24 option_1_name
    row[24] = colorValue || null; // 25 option_1_value
    row[25] = null; // 26 option_2_name
    row[26] = null; // 27 option_2_value
    row[27] = null; // 28 option_3_name
    row[28] = null; // 29 option_3_value
    row[29] = null; // 30 reduced_tax_rate
    row[30] = Math.round(wholesale * 100) / 100; // 31 eu_price_wholesale
    row[31] = Math.round(retail * 100) / 100; // 32 eu_price_retail
    row[32] = null; // 33 price_wholesale (USD)
    row[33] = null; // 34 price_retail (USD)
    row[34] = null; // 35 canadian_price_wholesale
    row[35] = null; // 36 canadian_price_retail
    row[36] = null; // 37 uk_price_wholesale
    row[37] = null; // 38 uk_price_retail
    row[38] = null; // 39 australian_price_wholesale
    row[39] = null; // 40 australian_price_retail
    row[40] = null; // 41 option_image
    row[41] = "Non"; // 42 preorderable
    row[42] = null; // 43 ship_by_start_date
    row[43] = null; // 44 ship_by_end_date
    row[44] = null; // 45 order_by_date
    row[45] = null; // 46 keep_active
    row[46] = productImages || null; // 47 product_images
    row[47] = madeIn || null; // 48 made_in_country
    row[48] = null; // 49 eu_tester_price
    row[49] = null; // 50 tester_price
    row[50] = null; // 51 canadian_tester_price
    row[51] = null; // 52 uk_tester_price
    row[52] = null; // 53 australian_tester_price
    row[53] = "Non"; // 54 has_customization
    row[54] = null; // 55 customization_instructions
    row[55] = null; // 56 customization_input_required
    row[56] = null; // 57 customization_input_limit
    row[57] = null; // 58 customization_moq
    row[58] = null; // 59 eu_customization_charge
    row[59] = null; // 60 customization_charge
    row[60] = null; // 61 canadian_customization_charge
    row[61] = null; // 62 uk_customization_charge
    row[62] = null; // 63 australian_customization_charge
    row[63] = null; // 64 continue_selling_when_out_of_stock
    row[64] = v.stock; // 65 on_hand_inventory
    row[65] = null; // 66 on_hand_inventory_original
    row[66] = null; // 67 restock_date
    row[67] = tariffCode; // 68 tariff_code

    return row;
  });
}

export async function generateFaireExcelFiles(
  products: ExportProduct[],
  ctx: ExportContext,
): Promise<{ filename: string; buffer: Buffer }[]> {
  if (products.length === 0) return [];

  // Charge le modèle officiel pour préserver instructions, listes déroulantes
  // d'« Options de données » et formatage des en-têtes — sinon Faire renvoie
  // « la colonne X est inconnue » à l'import.
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(FAIRE_TEMPLATE_PATH);

  const sheet = wb.getWorksheet(FAIRE_DATA_SHEET);
  if (!sheet) {
    throw new Error(
      `Modèle Faire : feuille « ${FAIRE_DATA_SHEET} » introuvable.`,
    );
  }

  // Le modèle peut contenir des lignes d'exemple sous l'en-tête (rare mais
  // possible). On vide cellule par cellule à partir de la ligne 4 en conservant
  // les styles hérités, comme pour Ankorstore.
  const oldRowCount = sheet.rowCount;
  for (let r = FAIRE_DATA_START_ROW; r <= oldRowCount; r++) {
    const row = sheet.getRow(r);
    for (let c = 1; c <= FAIRE_COLUMN_COUNT; c++) {
      row.getCell(c).value = null;
    }
  }

  let currentRow = FAIRE_DATA_START_ROW;
  for (const p of products) {
    for (const dataRow of productToFaireRows(p, ctx)) {
      const row = sheet.getRow(currentRow++);
      for (let i = 0; i < dataRow.length; i++) {
        row.getCell(i + 1).value = dataRow[i];
      }
    }
  }

  const buf = await wb.xlsx.writeBuffer();
  return [
    {
      filename: "faire.xlsx",
      buffer: Buffer.from(buf),
    },
  ];
}
