/**
 * Génère l'Excel d'import au format Beli & Jolie à partir du fichier source
 * en filtrant uniquement les produits dont Marketplace ET Microstore = "Hors Ligne".
 *
 * Sortie : C:/Users/Admin/Downloads/import-hors-ligne.xlsx
 */
const ExcelJS = require("exceljs");
const XLSX = require("xlsx");
const path = require("path");

const SOURCE = "C:/Users/Admin/Downloads/Produit (1).xlsx";
const DEST = "C:/Users/Admin/Downloads/import-hors-ligne.xlsx";

// ── Palette identique au template du site ──
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

// ── Mapping catégories source → Beli & Jolie ──
const CATEGORY_MAP = {
  "Boucles d'oreilles":  { category: "Boucles d'oreilles", sub: "" },
  "Collier":             { category: "Colliers",          sub: "" },
  "Collier en Y":        { category: "Colliers",          sub: "Collier en Y" },
  "Piercing Oreille":    { category: "Piercings",         sub: "" },
  "Bracelet jonc":       { category: "Bracelets",         sub: "Jonc" },
  "Bague ajustable":     { category: "Bagues",            sub: "Ajustable" },
  "Bracelet":            { category: "Bracelets",         sub: "" },
};

// ── Génération du Nom + Description selon catégorie + composition acier inox ──
function buildName(cat) {
  const map = {
    "Boucles d'oreilles": "Boucles d'oreilles en acier inoxydable",
    "Collier":            "Collier en acier inoxydable",
    "Collier en Y":       "Collier en Y en acier inoxydable",
    "Piercing Oreille":   "Piercing d'oreille en acier inoxydable",
    "Bracelet jonc":      "Bracelet jonc en acier inoxydable",
    "Bague ajustable":    "Bague ajustable en acier inoxydable",
    "Bracelet":           "Bracelet en acier inoxydable",
  };
  return map[cat] || `${cat} en acier inoxydable`;
}

function buildDescription(cat) {
  const map = {
    "Boucles d'oreilles": "Boucles d'oreilles en acier inoxydable, hypoallergéniques et résistantes à l'eau. Bijou femme léger et durable au design moderne, idéal pour un usage quotidien ou en cadeau.",
    "Collier":            "Collier en acier inoxydable, hypoallergénique et résistant à l'eau. Bijou femme délicat et durable, parfait pour un look chic au quotidien ou en cadeau.",
    "Collier en Y":       "Collier en Y en acier inoxydable, hypoallergénique et résistant à l'eau. Tombée élégante en pointe, idéal pour sublimer un décolleté avec un style moderne.",
    "Piercing Oreille":   "Piercing d'oreille en acier inoxydable, hypoallergénique et résistant à l'eau. Petit bijou discret et résistant, adapté au port quotidien.",
    "Bracelet jonc":      "Bracelet jonc en acier inoxydable, hypoallergénique et résistant à l'eau. Forme rigide ajustable au poignet, parfait pour un style minimaliste et intemporel.",
    "Bague ajustable":    "Bague ajustable en acier inoxydable, hypoallergénique et résistante à l'eau. Anneau ouvert qui s'adapte à toutes les tailles de doigt, idéal pour offrir.",
    "Bracelet":           "Bracelet en acier inoxydable, hypoallergénique et résistant à l'eau. Bijou femme léger et durable, parfait pour un look moderne au quotidien.",
  };
  return map[cat] || `${cat} en acier inoxydable, hypoallergénique et résistant à l'eau.`;
}

// ── Normalisation prix : "4,,9" → 4.9, "3.5" → 3.5, "3,5" → 3.5 ──
function normalizePrice(raw) {
  if (typeof raw === "number") return raw;
  if (raw == null) return null;
  const cleaned = String(raw).replace(/,/g, ".").replace(/\.+/g, ".");
  const n = parseFloat(cleaned);
  return Number.isFinite(n) ? n : null;
}

// ─────────────────────────────────────────────────────────────────
// MAIN
// ─────────────────────────────────────────────────────────────────
async function main() {
  // 1. Lecture source
  const wb = XLSX.readFile(SOURCE);
  const sh = wb.Sheets[wb.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json(sh, { defval: null });

  const filtered = rows.filter(
    (r) =>
      String(r["Marketplace"] || "").trim().toLowerCase() === "hors ligne" &&
      String(r["Microstore"] || "").trim().toLowerCase() === "hors ligne"
  );

  console.log(`→ ${filtered.length} produits filtrés (Marketplace + Microstore = Hors Ligne)`);

  // 2. Construction des lignes de l'Excel sortie
  const outputRows = [];
  let pricesFixes = [];

  for (const r of filtered) {
    const ref = String(r["Référence"]).trim();
    const cat = String(r["Catégorie"]).trim();
    const couleurs = String(r["Couleur"] || "").split(",").map((c) => c.trim()).filter(Boolean);
    let prix = normalizePrice(r["Prix"]);
    if (typeof r["Prix"] === "string" && r["Prix"].includes(",,")) {
      pricesFixes.push(`${ref}: "${r["Prix"]}" → ${prix}`);
    }

    const mapping = CATEGORY_MAP[cat];
    if (!mapping) {
      console.warn(`  ⚠ Catégorie inconnue pour ${ref}: "${cat}" — passée en l'état`);
    }

    const productFields = {
      reference: ref,
      name: buildName(cat),
      description: buildDescription(cat),
      category: mapping ? mapping.category : cat,
      sub_categories: mapping && mapping.sub ? mapping.sub : "",
      tags: "",
      composition: "Acier inoxydable:100",
      primary_color: couleurs[0] || "",
      pays_fabrication: "Chine",
      saison: "Toutes saisons",
      hs_code: "",
      taille_unique_details: "0",
      dimension_length: "",
      dimension_width: "",
      dimension_height: "",
      dimension_diameter: "",
      dimension_circumference: "",
      similar_refs: "",
      best_seller: "false",
    };

    // Une variante UNIT par couleur, taille = "Taille unique"
    couleurs.forEach((couleur, idx) => {
      const isFirst = idx === 0;
      outputRows.push({
        ...(isFirst
          ? productFields
          : Object.fromEntries(PRODUCT_COLUMNS.map((c) => [c.key, c.key === "reference" ? ref : ""]))),
        color: couleur,
        sale_type: "UNIT",
        size: "Taille unique",
        unit_price: prix,
        stock: 1000,
        pack_qty: "",
        discount_type: "",
        discount_value: "",
        weight_g: "",
      });
    });
  }

  if (pricesFixes.length) {
    console.log("\n⚠ Prix corrigés automatiquement (double virgule dans le source) :");
    pricesFixes.forEach((s) => console.log("   " + s));
  }

  // 3. Écriture du workbook
  const out = new ExcelJS.Workbook();
  out.creator = "Beli & Jolie — Import";
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
          "sale_type", "unit_price", "pack_qty", "stock", "weight_g",
          "discount_type", "discount_value", "size", "best_seller",
          "dimension_length", "dimension_width", "dimension_height",
          "dimension_diameter", "dimension_circumference",
        ].includes(col.key)
          ? "center"
          : undefined,
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

  await out.xlsx.writeFile(DEST);
  console.log(`\n✅ Fichier écrit : ${DEST}`);
  console.log(`   ${filtered.length} produits — ${outputRows.length} lignes de variantes`);
}

main().catch((e) => { console.error(e); process.exit(1); });
