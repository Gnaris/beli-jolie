import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import * as ExcelJS from "exceljs";

// ── Design tokens ──
const COLORS = {
  dark: "1A1A1A",
  white: "FFFFFF",
  surface: "F7F7F8",
  border: "E5E5E5",
  green: "22C55E",
  greenLight: "DCFCE7",
  amber: "F59E0B",
  amberLight: "FEF3C7",
  blue: "3B82F6",
  blueLight: "DBEAFE",
  grayLight: "F9FAFB",
  grayMed: "6B7280",
  red: "EF4444",
  redLight: "FEE2E2",
};

const FONT_HEADER: Partial<ExcelJS.Font> = {
  name: "Calibri",
  size: 11,
  bold: true,
  color: { argb: COLORS.white },
};

const FONT_BODY: Partial<ExcelJS.Font> = {
  name: "Calibri",
  size: 10,
  color: { argb: COLORS.dark },
};

const FONT_MUTED: Partial<ExcelJS.Font> = {
  name: "Calibri",
  size: 10,
  color: { argb: COLORS.grayMed },
  italic: true,
};

const BORDER_THIN: Partial<ExcelJS.Borders> = {
  top: { style: "thin", color: { argb: COLORS.border } },
  bottom: { style: "thin", color: { argb: COLORS.border } },
  left: { style: "thin", color: { argb: COLORS.border } },
  right: { style: "thin", color: { argb: COLORS.border } },
};

// ── Column definitions ──
interface ColumnDef {
  key: string;
  header: string;
  width: number;
  required: boolean;
  description: string;
  example: string;
}

const COLUMNS: ColumnDef[] = [
  { key: "reference", header: "reference *", width: 14, required: true, description: "Référence unique du produit", example: "BJ-001" },
  { key: "name", header: "name *", width: 28, required: true, description: "Nom du produit (en français)", example: "Collier Étoile" },
  { key: "description", header: "description", width: 38, required: false, description: "Description du produit", example: "Collier fin avec pendentif étoile" },
  { key: "category", header: "category", width: 20, required: false, description: "Catégorie (doit exister dans la base)", example: "Colliers" },
  { key: "sub_categories", header: "sub_categories", width: 22, required: false, description: "Sous-catégories séparées par des virgules", example: "Sautoir,Fin" },
  { key: "color", header: "color *", width: 24, required: true, description: "Couleur (multi-couleurs séparées par /)", example: "Doré" },
  { key: "sale_type", header: "sale_type *", width: 13, required: true, description: "UNIT ou PACK", example: "UNIT" },
  { key: "unit_price", header: "unit_price *", width: 14, required: true, description: "Prix unitaire HT en euros", example: "12.50" },
  { key: "pack_qty", header: "pack_qty", width: 12, required: false, description: "Quantité par pack (requis si PACK)", example: "" },
  { key: "stock", header: "stock *", width: 10, required: true, description: "Quantité en stock", example: "200" },
  { key: "weight_g", header: "weight_g", width: 12, required: false, description: "Poids en grammes", example: "30" },
  { key: "is_primary", header: "is_primary", width: 12, required: false, description: "true = variante principale (1 par produit)", example: "true" },
  { key: "discount_type", header: "discount_type", width: 15, required: false, description: "PERCENT ou AMOUNT", example: "" },
  { key: "discount_value", header: "discount_value", width: 15, required: false, description: "Valeur de la remise", example: "" },
  { key: "size", header: "size", width: 10, required: false, description: "Taille (ex: 17, 18)", example: "" },
  { key: "tags", header: "tags", width: 26, required: false, description: "Mots-clés séparés par des virgules", example: "étoile,fin,tendance" },
  { key: "composition", header: "composition", width: 32, required: false, description: "Matière:pourcentage (ex: Acier:85,Or:15)", example: "Acier inoxydable:100" },
  { key: "similar_refs", header: "similar_refs", width: 22, required: false, description: "Références produits similaires (virgules)", example: "BJ-002,BJ-003" },
];

// ── Sample data ──
const SAMPLE_DATA = [
  // Produit simple : 1 couleur, UNIT
  { reference: "BJ-001", name: "Collier Étoile", description: "Collier fin avec pendentif étoile", category: "Colliers", sub_categories: "Sautoir", color: "Doré", sale_type: "UNIT", unit_price: 12.50, pack_qty: "", stock: 200, weight_g: 30, is_primary: "true", discount_type: "", discount_value: "", size: "", tags: "étoile,fin,tendance", composition: "Acier inoxydable:100", similar_refs: "BJ-002,BJ-003" },
  // Multi-variantes : Doré UNIT
  { reference: "BJ-002", name: "Bracelet Jonc Classique", description: "Bracelet jonc ajustable, finition polie", category: "Bracelets", sub_categories: "Jonc,Ajustable", color: "Doré", sale_type: "UNIT", unit_price: 8.99, pack_qty: "", stock: 500, weight_g: 45, is_primary: "true", discount_type: "", discount_value: "", size: "", tags: "jonc,classique", composition: "Acier inoxydable:85,Or:15", similar_refs: "BJ-001" },
  // Même produit : Doré PACK
  { reference: "BJ-002", name: "", description: "", category: "", sub_categories: "", color: "Doré", sale_type: "PACK", unit_price: 7.50, pack_qty: 12, stock: 100, weight_g: "", is_primary: "", discount_type: "", discount_value: "", size: "", tags: "", composition: "", similar_refs: "" },
  // Même produit : Argenté UNIT
  { reference: "BJ-002", name: "", description: "", category: "", sub_categories: "", color: "Argenté", sale_type: "UNIT", unit_price: 8.99, pack_qty: "", stock: 300, weight_g: "", is_primary: "", discount_type: "", discount_value: "", size: "", tags: "", composition: "", similar_refs: "" },
  // Même produit : Argenté PACK
  { reference: "BJ-002", name: "", description: "", category: "", sub_categories: "", color: "Argenté", sale_type: "PACK", unit_price: 7.50, pack_qty: 12, stock: 80, weight_g: "", is_primary: "", discount_type: "", discount_value: "", size: "", tags: "", composition: "", similar_refs: "" },
  // Même produit : Or Rose UNIT
  { reference: "BJ-002", name: "", description: "", category: "", sub_categories: "", color: "Or Rose", sale_type: "UNIT", unit_price: 9.99, pack_qty: "", stock: 200, weight_g: "", is_primary: "", discount_type: "", discount_value: "", size: "", tags: "", composition: "", similar_refs: "" },
  // Multi-couleurs
  { reference: "BJ-003", name: "Bague Trio", description: "Bague tricolore empilable", category: "Bagues", sub_categories: "", color: "Doré/Argenté/Or Rose", sale_type: "UNIT", unit_price: 6.50, pack_qty: "", stock: 150, weight_g: 15, is_primary: "true", discount_type: "", discount_value: "", size: "17", tags: "trio,empilable", composition: "", similar_refs: "BJ-002" },
  // Même produit : PACK multi-couleurs
  { reference: "BJ-003", name: "", description: "", category: "", sub_categories: "", color: "Doré/Argenté/Or Rose", sale_type: "PACK", unit_price: 5.50, pack_qty: 24, stock: 40, weight_g: "", is_primary: "", discount_type: "", discount_value: "", size: "", tags: "", composition: "", similar_refs: "" },
  // Produit avec remise
  { reference: "BJ-004", name: "Boucles Créoles", description: "Créoles dorées élégantes", category: "Boucles d'oreilles", sub_categories: "", color: "Doré", sale_type: "UNIT", unit_price: 5.99, pack_qty: "", stock: 800, weight_g: 20, is_primary: "true", discount_type: "PERCENT", discount_value: 10, size: "", tags: "créoles", composition: "Acier inoxydable:100", similar_refs: "BJ-002,BJ-003" },
];

// Track which reference groups for alternating colors
function getProductGroupIndex(reference: string, data: typeof SAMPLE_DATA): number {
  const refs = Array.from(new Set(data.map((d) => d.reference)));
  return refs.indexOf(reference);
}

export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session || session.user.role !== "ADMIN") {
    return NextResponse.json({ error: "Non autorisé" }, { status: 401 });
  }

  const wb = new ExcelJS.Workbook();
  wb.creator = "Beli Jolie";
  wb.created = new Date();

  // ═══════════════════════════════════════════
  // FEUILLE 1 : Instructions
  // ═══════════════════════════════════════════
  const wsInstructions = wb.addWorksheet("Instructions", {
    properties: { tabColor: { argb: COLORS.green } },
  });

  // Title
  wsInstructions.mergeCells("B2:H2");
  const titleCell = wsInstructions.getCell("B2");
  titleCell.value = "📋  Guide d'importation des produits — Beli Jolie";
  titleCell.font = { name: "Calibri", size: 16, bold: true, color: { argb: COLORS.dark } };
  titleCell.alignment = { horizontal: "left", vertical: "middle" };
  wsInstructions.getRow(2).height = 36;

  // Subtitle
  wsInstructions.mergeCells("B3:H3");
  const subtitleCell = wsInstructions.getCell("B3");
  subtitleCell.value = "Remplissez l'onglet « Produits » en suivant les règles ci-dessous, puis importez le fichier.";
  subtitleCell.font = { name: "Calibri", size: 11, color: { argb: COLORS.grayMed } };
  wsInstructions.getRow(3).height = 24;

  // Section: Règles générales
  let row = 5;
  const addSection = (title: string, items: string[]) => {
    wsInstructions.mergeCells(`B${row}:H${row}`);
    const sectionCell = wsInstructions.getCell(`B${row}`);
    sectionCell.value = title;
    sectionCell.font = { name: "Calibri", size: 12, bold: true, color: { argb: COLORS.dark } };
    sectionCell.border = { bottom: { style: "medium", color: { argb: COLORS.dark } } };
    wsInstructions.getRow(row).height = 28;
    row++;

    for (const item of items) {
      wsInstructions.mergeCells(`B${row}:H${row}`);
      const itemCell = wsInstructions.getCell(`B${row}`);
      itemCell.value = item;
      itemCell.font = { name: "Calibri", size: 10, color: { argb: COLORS.dark } };
      itemCell.alignment = { wrapText: true, vertical: "top" };
      wsInstructions.getRow(row).height = 20;
      row++;
    }
    row++;
  };

  addSection("📌  Règles générales", [
    "• Une ligne = une variante (combinaison couleur + type de vente UNIT ou PACK).",
    "• Un même produit peut avoir plusieurs lignes avec la même référence (une par variante).",
    "• Seule la ligne principale (is_primary = true) doit contenir le nom, la description, la catégorie, etc.",
    "• Les lignes secondaires n'ont besoin que de : reference, color, sale_type, unit_price, stock.",
    "• Les colonnes marquées d'un astérisque (*) sont obligatoires.",
  ]);

  addSection("🎨  Couleurs multi-tons", [
    "• Pour une variante avec plusieurs sous-couleurs, séparez par / : Doré/Argenté/Or Rose",
    "• Les couleurs doivent exister dans la base (vous pourrez les créer depuis l'aperçu d'import).",
    "• La correspondance est insensible aux accents : Doré = DORE = doré",
  ]);

  addSection("📦  Packs", [
    "• Si sale_type = PACK, la colonne pack_qty est obligatoire.",
    "• Le prix total du pack sera calculé : unit_price × pack_qty (moins la remise éventuelle).",
  ]);

  addSection("💰  Remises", [
    "• discount_type : PERCENT (ex: 10 = -10%) ou AMOUNT (ex: 2 = -2€ par unité).",
    "• Laissez vide si pas de remise.",
  ]);

  addSection("🏷️  Tags & Composition", [
    "• tags : séparés par des virgules → étoile,fin,tendance",
    "• composition : format Matière:pourcentage → Acier inoxydable:85,Or:15",
    "• similar_refs : références de produits similaires, séparées par des virgules.",
  ]);

  // Column reference table
  row += 1;
  wsInstructions.mergeCells(`B${row}:H${row}`);
  const refTitle = wsInstructions.getCell(`B${row}`);
  refTitle.value = "📊  Référence des colonnes";
  refTitle.font = { name: "Calibri", size: 12, bold: true, color: { argb: COLORS.dark } };
  refTitle.border = { bottom: { style: "medium", color: { argb: COLORS.dark } } };
  wsInstructions.getRow(row).height = 28;
  row++;

  // Table headers
  const refHeaders = ["Colonne", "Obligatoire", "Description", "Exemple"];
  const refHeaderRow = wsInstructions.getRow(row);
  [2, 3, 5, 7].forEach((col, i) => {
    const cell = refHeaderRow.getCell(col);
    cell.value = refHeaders[i];
    cell.font = { name: "Calibri", size: 10, bold: true, color: { argb: COLORS.white } };
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: COLORS.dark } };
    cell.alignment = { horizontal: "left", vertical: "middle" };
    cell.border = BORDER_THIN;
  });
  // Merge description & example cols
  wsInstructions.mergeCells(`E${row}:F${row}`);
  wsInstructions.mergeCells(`G${row}:H${row}`);
  refHeaderRow.height = 24;
  row++;

  for (const col of COLUMNS) {
    const r = wsInstructions.getRow(row);
    const bgColor = col.required ? COLORS.greenLight : COLORS.white;

    const cellCol = r.getCell(2);
    cellCol.value = col.key;
    cellCol.font = { name: "Calibri", size: 10, bold: col.required, color: { argb: COLORS.dark } };
    cellCol.fill = { type: "pattern", pattern: "solid", fgColor: { argb: bgColor } };
    cellCol.border = BORDER_THIN;

    const cellReq = r.getCell(3);
    cellReq.value = col.required ? "✓ Oui" : "Non";
    cellReq.font = { name: "Calibri", size: 10, bold: col.required, color: { argb: col.required ? COLORS.green : COLORS.grayMed } };
    cellReq.fill = { type: "pattern", pattern: "solid", fgColor: { argb: bgColor } };
    cellReq.alignment = { horizontal: "center" };
    cellReq.border = BORDER_THIN;

    wsInstructions.mergeCells(`E${row}:F${row}`);
    const cellDesc = r.getCell(5);
    cellDesc.value = col.description;
    cellDesc.font = { name: "Calibri", size: 10, color: { argb: COLORS.dark } };
    cellDesc.fill = { type: "pattern", pattern: "solid", fgColor: { argb: bgColor } };
    cellDesc.alignment = { wrapText: true };
    cellDesc.border = BORDER_THIN;

    wsInstructions.mergeCells(`G${row}:H${row}`);
    const cellEx = r.getCell(7);
    cellEx.value = col.example;
    cellEx.font = FONT_MUTED;
    cellEx.fill = { type: "pattern", pattern: "solid", fgColor: { argb: bgColor } };
    cellEx.border = BORDER_THIN;

    r.height = 20;
    row++;
  }

  wsInstructions.getColumn(1).width = 3;
  wsInstructions.getColumn(2).width = 18;
  wsInstructions.getColumn(3).width = 14;
  wsInstructions.getColumn(4).width = 2;
  wsInstructions.getColumn(5).width = 22;
  wsInstructions.getColumn(6).width = 10;
  wsInstructions.getColumn(7).width = 16;
  wsInstructions.getColumn(8).width = 16;

  // Protect instructions sheet
  wsInstructions.protect("", { selectLockedCells: true, selectUnlockedCells: true });

  // ═══════════════════════════════════════════
  // FEUILLE 2 : Produits (données)
  // ═══════════════════════════════════════════
  const wsProduits = wb.addWorksheet("Produits", {
    properties: { tabColor: { argb: COLORS.dark } },
    views: [{ state: "frozen", ySplit: 1, activeCell: "A2" }],
  });

  // Set columns
  wsProduits.columns = COLUMNS.map((col) => ({
    header: col.header,
    key: col.key,
    width: col.width,
  }));

  // Style header row
  const headerRow = wsProduits.getRow(1);
  headerRow.height = 30;
  headerRow.eachCell((cell, colNumber) => {
    const colDef = COLUMNS[colNumber - 1];
    cell.font = FONT_HEADER;
    cell.fill = {
      type: "pattern",
      pattern: "solid",
      fgColor: { argb: colDef.required ? COLORS.dark : COLORS.grayMed },
    };
    cell.alignment = { horizontal: "center", vertical: "middle", wrapText: true };
    cell.border = {
      top: { style: "thin", color: { argb: COLORS.dark } },
      bottom: { style: "medium", color: { argb: COLORS.dark } },
      left: { style: "thin", color: { argb: COLORS.dark } },
      right: { style: "thin", color: { argb: COLORS.dark } },
    };
  });

  // Description row (row 2) — column descriptions as a helper row
  const descRow = wsProduits.getRow(2);
  descRow.height = 28;
  COLUMNS.forEach((col, i) => {
    const cell = descRow.getCell(i + 1);
    cell.value = col.description;
    cell.font = { name: "Calibri", size: 9, italic: true, color: { argb: COLORS.grayMed } };
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: COLORS.surface } };
    cell.alignment = { horizontal: "center", vertical: "middle", wrapText: true };
    cell.border = {
      bottom: { style: "medium", color: { argb: COLORS.border } },
      left: { style: "thin", color: { argb: COLORS.border } },
      right: { style: "thin", color: { argb: COLORS.border } },
    };
  });

  // Alternating product group colors
  const groupColors = [COLORS.white, COLORS.grayLight];

  // Add sample data rows starting at row 3
  SAMPLE_DATA.forEach((dataRow, idx) => {
    const excelRow = wsProduits.addRow(dataRow);
    const groupIdx = getProductGroupIndex(dataRow.reference, SAMPLE_DATA);
    const bgColor = groupColors[groupIdx % 2];

    excelRow.height = 22;
    excelRow.eachCell({ includeEmpty: true }, (cell, colNumber) => {
      const colDef = COLUMNS[colNumber - 1];
      const isEmpty = cell.value === "" || cell.value === null || cell.value === undefined;

      cell.font = isEmpty ? FONT_MUTED : FONT_BODY;
      cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: bgColor } };
      cell.border = BORDER_THIN;
      cell.alignment = { vertical: "middle", wrapText: colDef.key === "description" };

      // Highlight required empty cells
      if (colDef.required && isEmpty && idx > 0) {
        // Secondary rows don't need name/description/category
        // Only reference, color, sale_type, unit_price, stock are truly required per row
      }

      // Center numeric / short columns
      if (["sale_type", "unit_price", "pack_qty", "stock", "weight_g", "is_primary", "discount_type", "discount_value", "size"].includes(colDef.key)) {
        cell.alignment = { horizontal: "center", vertical: "middle" };
      }
    });
  });

  // Add data validation dropdowns
  const dataStartRow = 3;
  const dataEndRow = 100;

  // sale_type dropdown
  const saleTypeCol = COLUMNS.findIndex((c) => c.key === "sale_type") + 1;
  for (let r = dataStartRow; r <= dataEndRow; r++) {
    wsProduits.getCell(r, saleTypeCol).dataValidation = {
      type: "list",
      allowBlank: false,
      formulae: ['"UNIT,PACK"'],
      showErrorMessage: true,
      errorTitle: "Valeur invalide",
      error: "Choisissez UNIT ou PACK",
    };
  }

  // discount_type dropdown
  const discountTypeCol = COLUMNS.findIndex((c) => c.key === "discount_type") + 1;
  for (let r = dataStartRow; r <= dataEndRow; r++) {
    wsProduits.getCell(r, discountTypeCol).dataValidation = {
      type: "list",
      allowBlank: true,
      formulae: ['"PERCENT,AMOUNT"'],
      showErrorMessage: true,
      errorTitle: "Valeur invalide",
      error: "Choisissez PERCENT ou AMOUNT (ou laissez vide)",
    };
  }

  // is_primary dropdown
  const isPrimaryCol = COLUMNS.findIndex((c) => c.key === "is_primary") + 1;
  for (let r = dataStartRow; r <= dataEndRow; r++) {
    wsProduits.getCell(r, isPrimaryCol).dataValidation = {
      type: "list",
      allowBlank: true,
      formulae: ['"true,"'],
      showErrorMessage: true,
      errorTitle: "Valeur invalide",
      error: 'Indiquez "true" ou laissez vide',
    };
  }

  // Auto-filter on header
  wsProduits.autoFilter = {
    from: { row: 1, column: 1 },
    to: { row: 1, column: COLUMNS.length },
  };

  // Add comment indicators on required headers
  wsProduits.getCell(1, 1).note = "Chaque produit doit avoir une référence unique. Plusieurs lignes peuvent partager la même référence (variantes).";
  wsProduits.getCell(1, saleTypeCol).note = "UNIT = vente à l'unité\nPACK = vente en lot (pack_qty obligatoire)";

  // Generate buffer
  const buffer = await wb.xlsx.writeBuffer();

  return new NextResponse(buffer, {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": 'attachment; filename="template-produits-beli-jolie.xlsx"',
    },
  });
}
