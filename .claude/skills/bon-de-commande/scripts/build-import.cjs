#!/usr/bin/env node
/**
 * Génère l'Excel d'import Beli & Jolie à partir d'un fichier JSON de produits
 * traduits (chinois → français).
 *
 * Usage :
 *   node build-import.cjs <chemin-data.json> <chemin-sortie.xlsx>
 *
 * Format du JSON d'entrée :
 * {
 *   "supplier": "A",
 *   "defaults": {
 *     "composition": "Acier inoxydable:100",
 *     "pays_fabrication": "Chine",
 *     "saison": "Toutes saisons",
 *     "taille_unique_details": "0"
 *   },
 *   "products": [
 *     {
 *       "reference": "A2493",
 *       "fullRef": "A2493-448-280",
 *       "category": "Boucles d'oreilles",
 *       "sub_categories": "",
 *       "name": "…",
 *       "description": "…",
 *       "variants": [
 *          { "color": "Doré",  "unit_price": 4.8, "stock": 184 },
 *          { "color": "Argent","unit_price": 4.5, "stock": 70  }
 *       ]
 *     }, …
 *   ]
 * }
 *
 * S'inspire de scripts/generate-import-hors-ligne.js pour le style et la
 * structure visuelle exacts.
 */
const ExcelJS = require("exceljs");
const fs = require("fs");
const path = require("path");

const DATA_PATH = process.argv[2];
const OUT_PATH = process.argv[3];

if (!DATA_PATH || !OUT_PATH) {
  console.error("Usage : node build-import.cjs <data.json> <sortie.xlsx>");
  process.exit(1);
}

const COLORS = {
  ink: "1F2937", inkSoft: "475569", inkMuted: "94A3B8", white: "FFFFFF",
  border: "E2E8F0", borderSoft: "F1F5F9",
  productBand: "64748B", productHeaderReq: "334155", productHeaderOpt: "94A3B8", productSurface: "F8FAFC",
  variantBand: "78716C", variantHeaderReq: "44403C", variantHeaderOpt: "A8A29E", variantSurface: "FAFAF9",
  requiredBg: "FEE2E2", requiredText: "B91C1C", optionalBg: "F1F5F9", optionalText: "64748B",
  dataRowA: "FFFFFF", dataRowB: "FAFAFA",
};

const BORDER_THIN = {
  top: { style: "thin", color: { argb: COLORS.border } },
  bottom: { style: "thin", color: { argb: COLORS.border } },
  left: { style: "thin", color: { argb: COLORS.border } },
  right: { style: "thin", color: { argb: COLORS.border } },
};

const PRODUCT_COLUMNS = [
  { key: "reference", header: "Référence *", width: 14, required: true, example: "PRD-001" },
  { key: "name", header: "Nom *", width: 28, required: true, example: "Produit Étoile" },
  { key: "description", header: "Description *", width: 38, required: true, example: "Produit fin avec motif étoile" },
  { key: "category", header: "Catégorie *", width: 20, required: true, example: "Accessoires" },
  { key: "sub_categories", header: "Sous-catégories", width: 22, required: false, example: "Sautoir,Fin" },
  { key: "tags", header: "Tags", width: 26, required: false, example: "étoile,fin,tendance" },
  { key: "composition", header: "Composition *", width: 32, required: true, example: "Coton:100" },
  { key: "primary_color", header: "Couleur principale", width: 20, required: false, example: "Doré" },
  { key: "pays_fabrication", header: "Pays fabrication *", width: 18, required: true, example: "France" },
  { key: "saison", header: "Saison *", width: 16, required: true, example: "Été 2026" },
  { key: "hs_code", header: "Code SH", width: 14, required: false, example: "71171900" },
  { key: "taille_unique_details", header: "Détail taille unique *", width: 22, required: true, example: "52-56" },
  { key: "dimension_length", header: "Longueur (cm)", width: 16, required: false, example: "45" },
  { key: "dimension_width", header: "Largeur (cm)", width: 16, required: false, example: "2" },
  { key: "dimension_height", header: "Hauteur (cm)", width: 16, required: false, example: "" },
  { key: "dimension_diameter", header: "Diamètre (cm)", width: 16, required: false, example: "6.5" },
  { key: "dimension_circumference", header: "Circonférence (cm)", width: 20, required: false, example: "" },
  { key: "similar_refs", header: "Réf. similaires", width: 22, required: false, example: "PRD-002,PRD-003" },
  { key: "best_seller", header: "Best Seller", width: 12, required: false, example: "false" },
];

const VARIANT_COLUMNS = [
  { key: "color", header: "Couleur *", width: 24, required: true, example: "Doré" },
  { key: "sale_type", header: "Type de vente *", width: 15, required: true, example: "UNIT" },
  { key: "size", header: "Taille *", width: 18, required: true, example: "M" },
  { key: "unit_price", header: "Prix unitaire *", width: 15, required: true, example: "12.50" },
  { key: "stock", header: "Stock *", width: 10, required: true, example: "200" },
  { key: "pack_qty", header: "Qté pack", width: 12, required: false, example: "" },
  { key: "discount_type", header: "Type remise", width: 15, required: false, example: "PERCENT" },
  { key: "discount_value", header: "Valeur remise", width: 15, required: false, example: "10" },
  { key: "weight_kg", header: "Poids (kg) *", width: 12, required: true, example: "0.030" },
];

const COLUMNS = [...PRODUCT_COLUMNS, ...VARIANT_COLUMNS];
const PRODUCT_COL_COUNT = PRODUCT_COLUMNS.length;
const VARIANT_COL_COUNT = VARIANT_COLUMNS.length;

function colLetter(index) {
  let n = index + 1;
  let result = "";
  while (n > 0) {
    const rem = (n - 1) % 26;
    result = String.fromCharCode(65 + rem) + result;
    n = Math.floor((n - 1) / 26);
  }
  return result;
}

function nameFromCategory(cat) {
  // Catégories au singulier côté site Beli & Jolie.
  const map = {
    "Boucle d'oreille":   "Boucles d'oreilles en acier inoxydable",
    "Collier":            "Collier en acier inoxydable",
    "Bague":              "Bague en acier inoxydable",
    "Bracelet":           "Bracelet en acier inoxydable",
    "Pendentif":          "Pendentif en acier inoxydable",
    "Broche":             "Broche en acier inoxydable",
    "Bracelet de main":   "Bracelet de main en acier inoxydable",
    "Chaîne de cheville": "Chaîne de cheville en acier inoxydable",
  };
  return map[cat] || `${cat} en acier inoxydable`;
}

function descFromCategory(cat) {
  const map = {
    "Boucle d'oreille":   "Boucles d'oreilles en acier inoxydable, hypoallergéniques et résistantes à l'eau. Bijou femme léger et durable au design moderne, idéal pour un usage quotidien ou en cadeau.",
    "Collier":            "Collier en acier inoxydable, hypoallergénique et résistant à l'eau. Bijou femme délicat et durable, parfait pour un look chic au quotidien ou en cadeau.",
    "Bague":              "Bague en acier inoxydable, hypoallergénique et résistante à l'eau. Anneau durable et confortable, idéal pour un usage quotidien.",
    "Bracelet":           "Bracelet en acier inoxydable, hypoallergénique et résistant à l'eau. Bijou femme léger et durable, parfait pour un look moderne au quotidien.",
    "Pendentif":          "Pendentif en acier inoxydable, hypoallergénique et résistant à l'eau. Bijou femme délicat et durable.",
    "Broche":             "Broche en acier inoxydable, hypoallergénique et résistante à l'eau. Bijou femme durable au design moderne.",
    "Bracelet de main":   "Bracelet de main en acier inoxydable, hypoallergénique et résistant à l'eau. Bijou femme léger et durable.",
    "Chaîne de cheville": "Chaîne de cheville en acier inoxydable, hypoallergénique et résistante à l'eau. Bijou femme léger et durable.",
  };
  return map[cat] || `${cat} en acier inoxydable, hypoallergénique et résistant à l'eau.`;
}

async function main() {
  const data = JSON.parse(fs.readFileSync(DATA_PATH, "utf-8"));

  const defaults = {
    composition: "Acier inoxydable:100",
    pays_fabrication: "Chine",
    saison: "Toutes saisons",
    taille_unique_details: "0",
    ...(data.defaults || {}),
  };

  // Construction des lignes
  const outputRows = [];
  for (const p of data.products) {
    const productFields = {
      reference: p.reference,
      name: p.name || nameFromCategory(p.category),
      description: p.description || descFromCategory(p.category),
      category: p.category,
      sub_categories: p.sub_categories || "",
      tags: p.tags || "",
      composition: p.composition || defaults.composition,
      primary_color: p.primary_color || (p.variants?.[0]?.color || ""),
      pays_fabrication: p.pays_fabrication || defaults.pays_fabrication,
      saison: p.saison || defaults.saison,
      hs_code: p.hs_code || "",
      taille_unique_details: p.taille_unique_details || defaults.taille_unique_details,
      dimension_length: "",
      dimension_width: "",
      dimension_height: "",
      dimension_diameter: "",
      dimension_circumference: "",
      similar_refs: p.similar_refs || "",
      best_seller: "false",
    };

    (p.variants || []).forEach((v, idx) => {
      const isFirst = idx === 0;
      outputRows.push({
        ...(isFirst
          ? productFields
          : Object.fromEntries(
              PRODUCT_COLUMNS.map((c) => [c.key, c.key === "reference" ? p.reference : ""])
            )),
        color: v.color,
        sale_type: v.sale_type || "UNIT",
        size: v.size || "Taille unique",
        unit_price: v.unit_price,
        stock: v.stock,
        pack_qty: v.pack_qty || "",
        discount_type: v.discount_type || "",
        discount_value: v.discount_value || "",
        weight_kg: v.weight_kg || "",
      });
    });
  }

  const out = new ExcelJS.Workbook();
  out.creator = "Beli & Jolie — Import bon de commande";
  out.created = new Date();
  const ws = out.addWorksheet("Produits", {
    properties: { tabColor: { argb: COLORS.ink } },
    views: [{ state: "frozen", ySplit: 4, activeCell: "A5" }],
  });

  COLUMNS.forEach((col, i) => {
    ws.getColumn(i + 1).width = col.width;
  });

  // Ligne 1 — bandeaux
  ws.getRow(1).height = 30;
  const productFirstCol = colLetter(0);
  const productLastCol = colLetter(PRODUCT_COL_COUNT - 1);
  ws.mergeCells(`${productFirstCol}1:${productLastCol}1`);
  const productSectionCell = ws.getCell(`${productFirstCol}1`);
  productSectionCell.value = "🛍️  Fiche produit  —  à remplir une seule fois par référence";
  productSectionCell.font = { name: "Calibri", size: 12, bold: true, color: { argb: COLORS.white } };
  productSectionCell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: COLORS.productBand } };
  productSectionCell.alignment = { horizontal: "center", vertical: "middle" };
  productSectionCell.border = BORDER_THIN;

  const variantFirstCol = colLetter(PRODUCT_COL_COUNT);
  const variantLastCol = colLetter(PRODUCT_COL_COUNT + VARIANT_COL_COUNT - 1);
  ws.mergeCells(`${variantFirstCol}1:${variantLastCol}1`);
  const variantSectionCell = ws.getCell(`${variantFirstCol}1`);
  variantSectionCell.value = "🎨  Variante  —  une ligne par variante";
  variantSectionCell.font = { name: "Calibri", size: 12, bold: true, color: { argb: COLORS.white } };
  variantSectionCell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: COLORS.variantBand } };
  variantSectionCell.alignment = { horizontal: "center", vertical: "middle" };
  variantSectionCell.border = BORDER_THIN;

  // Ligne 2 — headers
  const headerRow = ws.getRow(2);
  headerRow.height = 32;
  COLUMNS.forEach((col, i) => {
    const cell = headerRow.getCell(i + 1);
    cell.value = col.header;
    cell.font = { name: "Calibri", size: 11, bold: true, color: { argb: COLORS.white } };
    const isProductCol = i < PRODUCT_COL_COUNT;
    const bgColor = isProductCol
      ? (col.required ? COLORS.productHeaderReq : COLORS.productHeaderOpt)
      : (col.required ? COLORS.variantHeaderReq : COLORS.variantHeaderOpt);
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: bgColor } };
    cell.alignment = { horizontal: "center", vertical: "middle", wrapText: true };
    cell.border = BORDER_THIN;
  });

  // Ligne 3 — Obligatoire / Facultatif
  const reqRow = ws.getRow(3);
  reqRow.height = 22;
  COLUMNS.forEach((col, i) => {
    const cell = reqRow.getCell(i + 1);
    cell.value = col.required ? "Obligatoire" : "Facultatif";
    cell.font = {
      name: "Calibri", size: 9, bold: col.required, italic: !col.required,
      color: { argb: col.required ? COLORS.requiredText : COLORS.optionalText },
    };
    cell.fill = {
      type: "pattern", pattern: "solid",
      fgColor: { argb: col.required ? COLORS.requiredBg : COLORS.optionalBg },
    };
    cell.alignment = { horizontal: "center", vertical: "middle" };
    cell.border = BORDER_THIN;
  });

  // Ligne 4 — exemple « (ex : ...) »
  const exampleRow = ws.getRow(4);
  exampleRow.height = 22;
  COLUMNS.forEach((col, i) => {
    const cell = exampleRow.getCell(i + 1);
    cell.value = col.example ? `(ex : ${col.example})` : "(—)";
    cell.font = { name: "Calibri", size: 9, italic: true, color: { argb: COLORS.inkMuted } };
    const isProductCol = i < PRODUCT_COL_COUNT;
    cell.fill = {
      type: "pattern", pattern: "solid",
      fgColor: { argb: isProductCol ? COLORS.productSurface : COLORS.variantSurface },
    };
    cell.alignment = { horizontal: "center", vertical: "middle", wrapText: true };
    cell.border = BORDER_THIN;
  });

  // Lignes 5+ — données
  const refOrder = Array.from(new Set(outputRows.map((r) => r.reference)));
  const groupBg = [COLORS.dataRowA, COLORS.dataRowB];
  outputRows.forEach((dataRow, idx) => {
    const excelRow = ws.getRow(5 + idx);
    const groupIdx = refOrder.indexOf(dataRow.reference);
    const bgColor = groupBg[groupIdx % 2];
    excelRow.height = 22;
    COLUMNS.forEach((col, i) => {
      const cell = excelRow.getCell(i + 1);
      const raw = dataRow[col.key];
      const value = raw === undefined || raw === null ? "" : raw;
      cell.value = value;
      const isEmpty = value === "" || value === null || value === undefined;
      cell.font = {
        name: "Calibri", size: 10,
        color: { argb: isEmpty ? COLORS.inkMuted : COLORS.ink },
        italic: isEmpty,
      };
      cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: bgColor } };
      cell.border = BORDER_THIN;
      cell.alignment = {
        vertical: "middle",
        wrapText: col.key === "description",
        horizontal: [
          "sale_type", "unit_price", "pack_qty", "stock", "weight_kg",
          "discount_type", "discount_value", "size", "best_seller",
          "dimension_length", "dimension_width", "dimension_height",
          "dimension_diameter", "dimension_circumference",
        ].includes(col.key) ? "center" : undefined,
      };
    });
  });

  // Validations
  const dataStartRow = 5;
  const dataEndRow = Math.max(200, 5 + outputRows.length + 50);
  const findCol = (key) => COLUMNS.findIndex((c) => c.key === key) + 1;
  for (let r = dataStartRow; r <= dataEndRow; r++) {
    ws.getCell(r, findCol("sale_type")).dataValidation = {
      type: "list", allowBlank: false, formulae: ['"UNIT,PACK"'],
      showErrorMessage: true, errorTitle: "Valeur invalide", error: "Choisissez UNIT ou PACK",
    };
    ws.getCell(r, findCol("discount_type")).dataValidation = {
      type: "list", allowBlank: true, formulae: ['"PERCENT,AMOUNT"'],
      showErrorMessage: true, errorTitle: "Valeur invalide", error: "Choisissez PERCENT ou AMOUNT",
    };
    ws.getCell(r, findCol("best_seller")).dataValidation = {
      type: "list", allowBlank: true, formulae: ['"true,false"'],
      showErrorMessage: true, errorTitle: "Valeur invalide", error: 'Indiquez "true" ou "false".',
    };
  }

  ws.autoFilter = { from: { row: 2, column: 1 }, to: { row: 2, column: COLUMNS.length } };

  await out.xlsx.writeFile(OUT_PATH);
  console.log(`✅ Fichier écrit : ${OUT_PATH}`);
  console.log(`   ${data.products.length} produits — ${outputRows.length} lignes de variantes`);
}

main().catch((e) => { console.error(e); process.exit(1); });
