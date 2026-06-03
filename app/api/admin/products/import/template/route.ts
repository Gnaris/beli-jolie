import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import * as ExcelJS from "exceljs";

// ── Palette neutre (slate + stone) ──
const COLORS = {
  // Texte
  ink: "1F2937",          // gray-800 — texte principal
  inkSoft: "475569",      // slate-600 — texte secondaire
  inkMuted: "94A3B8",     // slate-400 — texte gris doux
  white: "FFFFFF",
  // Bordures
  border: "E2E8F0",       // slate-200
  borderSoft: "F1F5F9",   // slate-100
  // Section "Fiche produit" — slate (gris-bleuté)
  productBand: "64748B",       // slate-500 — bandeau ligne 1
  productHeaderReq: "334155",  // slate-700 — header obligatoire
  productHeaderOpt: "94A3B8",  // slate-400 — header facultatif
  productSurface: "F8FAFC",    // slate-50 — fond exemples
  // Section "Variante" — stone (gris-sable)
  variantBand: "78716C",       // stone-500 — bandeau ligne 1
  variantHeaderReq: "44403C",  // stone-700 — header obligatoire
  variantHeaderOpt: "A8A29E",  // stone-400 — header facultatif
  variantSurface: "FAFAF9",    // stone-50 — fond exemples
  // Statut obligatoire/facultatif
  requiredBg: "FEE2E2",   // red-100
  requiredText: "B91C1C", // red-700
  optionalBg: "F1F5F9",   // slate-100
  optionalText: "64748B", // slate-500
  // Lignes de données
  dataRowA: "FFFFFF",
  dataRowB: "FAFAFA",     // neutral-50
};

const BORDER_THIN: Partial<ExcelJS.Borders> = {
  top: { style: "thin", color: { argb: COLORS.border } },
  bottom: { style: "thin", color: { argb: COLORS.border } },
  left: { style: "thin", color: { argb: COLORS.border } },
  right: { style: "thin", color: { argb: COLORS.border } },
};

// ── Définition d'une colonne ──
interface ColumnDef {
  key: string;
  header: string;
  width: number;
  required: boolean;
  description: string;
  example: string;
}

// ════════════════════════════════════════════════════════════════════
// FICHE PRODUIT — à remplir une seule fois par référence
// Ordre par regroupement logique :
//   1. Identité       (référence, noms, descriptions)
//   2. Classement     (catégories, tags)
//   3. Caractéristiques (composition, couleur, origine, code SH)
//   4. Dimensions
//   5. Publication & liens (similar, statut, best seller)
// ════════════════════════════════════════════════════════════════════
const PRODUCT_COLUMNS: ColumnDef[] = [
  // — Identité —
  { key: "reference", header: "Référence *", width: 14, required: true, description: "Référence unique du produit", example: "PRD-001" },
  { key: "name", header: "Nom *", width: 28, required: true, description: "Nom du produit (en français)", example: "Produit Étoile" },
  { key: "description", header: "Description *", width: 38, required: true, description: "Description du produit", example: "Produit fin avec motif étoile" },
  { key: "name_en", header: "Nom (EN)", width: 28, required: false, description: "Traduction anglaise du nom (sinon DeepL traduit auto)", example: "Star Product" },
  { key: "description_en", header: "Description (EN)", width: 38, required: false, description: "Traduction anglaise de la description", example: "Fine product with star motif" },
  // — Classement —
  { key: "category", header: "Catégorie *", width: 20, required: true, description: "Doit exister dans la base", example: "Accessoires" },
  { key: "sub_categories", header: "Sous-catégories", width: 22, required: false, description: "Séparées par des virgules", example: "Sautoir,Fin" },
  { key: "tags", header: "Tags", width: 26, required: false, description: "Mots-clés séparés par des virgules", example: "étoile,fin,tendance" },
  // — Caractéristiques —
  { key: "composition", header: "Composition *", width: 32, required: true, description: "Matière:% (ex: Coton:85,Polyester:15)", example: "Coton:100" },
  { key: "primary_color", header: "Couleur principale", width: 20, required: false, description: "Nom de la couleur affichée par défaut (doit faire partie des variantes)", example: "Doré" },
  { key: "pays_fabrication", header: "Pays fabrication *", width: 18, required: true, description: "Doit exister dans la base", example: "France" },
  { key: "saison", header: "Saison *", width: 16, required: true, description: "Doit exister dans la base", example: "Été 2026" },
  { key: "hs_code", header: "Code SH", width: 14, required: false, description: "Code douanier (doit exister dans Administration > Codes SH)", example: "71171900" },
  // — Dimensions —
  { key: "taille_unique_details", header: "Détail taille unique", width: 22, required: false, description: "Texte libre (ex: 52-56). Obligatoire dès qu'une variante utilise « Taille unique ».", example: "52-56" },
  { key: "dimension_length", header: "Longueur (cm)", width: 16, required: false, description: "Longueur en cm", example: "45" },
  { key: "dimension_width", header: "Largeur (cm)", width: 16, required: false, description: "Largeur en cm", example: "2" },
  { key: "dimension_height", header: "Hauteur (cm)", width: 16, required: false, description: "Hauteur en cm", example: "" },
  { key: "dimension_diameter", header: "Diamètre (cm)", width: 16, required: false, description: "Diamètre en cm", example: "6.5" },
  { key: "dimension_circumference", header: "Circonférence (cm)", width: 20, required: false, description: "Circonférence en cm", example: "" },
  // — Publication & liens —
  { key: "similar_refs", header: "Réf. similaires", width: 22, required: false, description: "Références produits similaires (virgules)", example: "PRD-002,PRD-003" },
  { key: "status", header: "Statut", width: 12, required: false, description: "OFFLINE (défaut), ONLINE ou ARCHIVED", example: "OFFLINE" },
  { key: "best_seller", header: "Best Seller", width: 12, required: false, description: "true = mis en avant dans les filtres", example: "false" },
];

// ════════════════════════════════════════════════════════════════════
// VARIANTE — une ligne par variante (couleur × type de vente)
// Ordre par regroupement logique :
//   1. Identité variante (couleur, type, taille, primaire)
//   2. Prix & stock
//   3. Logistique (poids)
// ════════════════════════════════════════════════════════════════════
const VARIANT_COLUMNS: ColumnDef[] = [
  // — Identité variante —
  { key: "color", header: "Couleur *", width: 24, required: true, description: "Multi-couleurs séparées par /", example: "Doré" },
  { key: "sale_type", header: "Type de vente *", width: 15, required: true, description: "UNIT ou PACK", example: "UNIT" },
  { key: "size", header: "Taille *", width: 18, required: true, description: "UNIT : M, 42… PACK : taille:qté (ex: S:2,M:3,L:1). Écrivez « Taille unique » pour le bloc PFS TU.", example: "M" },
  { key: "is_primary", header: "Primaire", width: 12, required: false, description: "true = variante principale (1 seule par produit)", example: "true" },
  // — Prix & stock —
  { key: "unit_price", header: "Prix unitaire *", width: 15, required: true, description: "Prix HT en euros", example: "12.50" },
  { key: "stock", header: "Stock *", width: 10, required: true, description: "Quantité en stock", example: "200" },
  { key: "pack_qty", header: "Qté pack", width: 12, required: false, description: "Auto-calculé depuis les tailles si PACK", example: "" },
  { key: "discount_type", header: "Type remise", width: 15, required: false, description: "PERCENT (seul type supporté)", example: "PERCENT" },
  { key: "discount_value", header: "Valeur remise", width: 15, required: false, description: "Valeur de la remise en %", example: "10" },
  // — Logistique —
  { key: "weight_g", header: "Poids (g)", width: 12, required: false, description: "Poids en grammes", example: "30" },
];

const COLUMNS: ColumnDef[] = [...PRODUCT_COLUMNS, ...VARIANT_COLUMNS];
const PRODUCT_COL_COUNT = PRODUCT_COLUMNS.length;
const VARIANT_COL_COUNT = VARIANT_COLUMNS.length;

// ── Données-exemple (3 produits) ──
const SAMPLE_DATA = [
  // T-shirt simple, 1 variante UNIT
  {
    reference: "TSH-001", name: "T-shirt Essentiel", description: "T-shirt col rond en coton bio, coupe droite",
    name_en: "", description_en: "",
    category: "T-shirt", sub_categories: "Manche courte,Basique", tags: "basique,coton,essentiel",
    composition: "Coton:100", primary_color: "Blanc", pays_fabrication: "Portugal", saison: "Été 2026", hs_code: "",
    taille_unique_details: "", dimension_length: "", dimension_width: "", dimension_height: "", dimension_diameter: "", dimension_circumference: "",
    similar_refs: "", status: "OFFLINE", best_seller: "false",
    color: "Blanc", sale_type: "UNIT", size: "M", is_primary: "true",
    unit_price: 14.90, stock: 500, pack_qty: "", discount_type: "", discount_value: "",
    weight_g: 180,
  },
  // T-shirt 3 variantes (fiche produit uniquement sur la 1ʳᵉ ligne)
  {
    reference: "TSH-002", name: "T-shirt Oversize Urban", description: "T-shirt oversize à épaules tombantes",
    name_en: "", description_en: "",
    category: "T-shirt", sub_categories: "Oversize,Streetwear", tags: "oversize,streetwear",
    composition: "Coton:90,Élasthanne:10", primary_color: "Noir", pays_fabrication: "Turquie", saison: "Automne 2026", hs_code: "",
    taille_unique_details: "", dimension_length: "", dimension_width: "", dimension_height: "", dimension_diameter: "", dimension_circumference: "",
    similar_refs: "TSH-001", status: "OFFLINE", best_seller: "false",
    color: "Noir", sale_type: "UNIT", size: "L", is_primary: "true",
    unit_price: 24.90, stock: 300, pack_qty: "", discount_type: "", discount_value: "",
    weight_g: 220,
  },
  {
    reference: "TSH-002", name: "", description: "", name_en: "", description_en: "",
    category: "", sub_categories: "", tags: "",
    composition: "", primary_color: "", pays_fabrication: "", saison: "", hs_code: "",
    taille_unique_details: "", dimension_length: "", dimension_width: "", dimension_height: "", dimension_diameter: "", dimension_circumference: "",
    similar_refs: "", status: "", best_seller: "",
    color: "Kaki", sale_type: "UNIT", size: "M", is_primary: "",
    unit_price: 24.90, stock: 200, pack_qty: "", discount_type: "", discount_value: "",
    weight_g: "",
  },
  {
    reference: "TSH-002", name: "", description: "", name_en: "", description_en: "",
    category: "", sub_categories: "", tags: "",
    composition: "", primary_color: "", pays_fabrication: "", saison: "", hs_code: "",
    taille_unique_details: "", dimension_length: "", dimension_width: "", dimension_height: "", dimension_diameter: "", dimension_circumference: "",
    similar_refs: "", status: "", best_seller: "",
    color: "Beige", sale_type: "UNIT", size: "S", is_primary: "",
    unit_price: 24.90, stock: 250, pack_qty: "", discount_type: "PERCENT", discount_value: 10,
    weight_g: "",
  },
  // Mocassin + PACK
  {
    reference: "MOC-001", name: "Mocassin Cambridge", description: "Mocassin en cuir pleine fleur, semelle cousue Blake",
    name_en: "", description_en: "",
    category: "Mocassin", sub_categories: "Cuir,Classique", tags: "cuir,élégant,classique",
    composition: "Cuir:100", primary_color: "Marron", pays_fabrication: "Italie", saison: "Hiver 2026", hs_code: "",
    taille_unique_details: "",
    dimension_length: 28, dimension_width: 10, dimension_height: 8, dimension_diameter: "", dimension_circumference: "",
    similar_refs: "", status: "OFFLINE", best_seller: "false",
    color: "Marron", sale_type: "UNIT", size: "43", is_primary: "true",
    unit_price: 89.90, stock: 80, pack_qty: "", discount_type: "", discount_value: "",
    weight_g: 380,
  },
  {
    reference: "MOC-001", name: "", description: "", name_en: "", description_en: "",
    category: "", sub_categories: "", tags: "",
    composition: "", primary_color: "", pays_fabrication: "", saison: "", hs_code: "",
    taille_unique_details: "", dimension_length: "", dimension_width: "", dimension_height: "", dimension_diameter: "", dimension_circumference: "",
    similar_refs: "", status: "", best_seller: "",
    color: "Marron", sale_type: "PACK", size: "41:1,42:1,43:1,44:1", is_primary: "",
    unit_price: 14.90, stock: 15, pack_qty: "", discount_type: "PERCENT", discount_value: 25,
    weight_g: "",
  },
];

function getProductGroupIndex(reference: string, data: typeof SAMPLE_DATA): number {
  const refs = Array.from(new Set(data.map((d) => d.reference)));
  return refs.indexOf(reference);
}

function colLetter(index: number): string {
  let n = index + 1;
  let result = "";
  while (n > 0) {
    const rem = (n - 1) % 26;
    result = String.fromCharCode(65 + rem) + result;
    n = Math.floor((n - 1) / 26);
  }
  return result;
}

export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session || session.user.role !== "ADMIN") {
    return NextResponse.json({ error: "Non autorisé" }, { status: 401 });
  }

  const wb = new ExcelJS.Workbook();
  wb.creator = "Admin";
  wb.created = new Date();

  // ═══════════════════════════════════════════════════════════════════
  // Une seule feuille : "Produits"
  //
  // Structure (5 lignes d'en-tête figées) :
  //   Ligne 1 : bandeau de section (« 🛍️ Fiche produit » / « 🎨 Variante »)
  //   Ligne 2 : header de colonne (« Référence * », « Nom * », …)
  //   Ligne 3 : indication « Obligatoire » (rouge) / « Facultatif » (gris)
  //   Ligne 4 : exemple « (ex : ...) » en italique gris
  //   Ligne 5+ : 3 produits-exemple + lignes vides à remplir
  //
  // Côté parseur :
  //   - `range: 1` saute la ligne 1 (section) → ligne 2 devient les headers
  //   - le filtre rejette : ref = "Obligatoire" / "Facultatif" / ref qui commence par "(ex"
  // ═══════════════════════════════════════════════════════════════════
  const ws = wb.addWorksheet("Produits", {
    properties: { tabColor: { argb: COLORS.ink } },
    views: [{ state: "frozen", ySplit: 4, activeCell: "A5" }],
  });

  // Largeurs
  COLUMNS.forEach((col, i) => {
    ws.getColumn(i + 1).width = col.width;
  });

  // ── Ligne 1 : bandeaux de section ──
  ws.getRow(1).height = 30;

  const productFirstCol = colLetter(0);
  const productLastCol = colLetter(PRODUCT_COL_COUNT - 1);
  ws.mergeCells(`${productFirstCol}1:${productLastCol}1`);
  const productSectionCell = ws.getCell(`${productFirstCol}1`);
  productSectionCell.value = "🛍️  Fiche produit  —  à remplir une seule fois par référence (les lignes de variantes suivantes héritent automatiquement)";
  productSectionCell.font = { name: "Calibri", size: 12, bold: true, color: { argb: COLORS.white } };
  productSectionCell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: COLORS.productBand } };
  productSectionCell.alignment = { horizontal: "center", vertical: "middle" };
  productSectionCell.border = BORDER_THIN;

  const variantFirstCol = colLetter(PRODUCT_COL_COUNT);
  const variantLastCol = colLetter(PRODUCT_COL_COUNT + VARIANT_COL_COUNT - 1);
  ws.mergeCells(`${variantFirstCol}1:${variantLastCol}1`);
  const variantSectionCell = ws.getCell(`${variantFirstCol}1`);
  variantSectionCell.value = "🎨  Variante  —  une ligne par variante (couleur × type de vente)";
  variantSectionCell.font = { name: "Calibri", size: 12, bold: true, color: { argb: COLORS.white } };
  variantSectionCell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: COLORS.variantBand } };
  variantSectionCell.alignment = { horizontal: "center", vertical: "middle" };
  variantSectionCell.border = BORDER_THIN;

  // ── Ligne 2 : headers ──
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
    cell.note = `${col.description}${col.example ? `\nExemple : ${col.example}` : ""}`;
  });

  // ── Ligne 3 : Obligatoire / Facultatif ──
  const reqRow = ws.getRow(3);
  reqRow.height = 22;
  COLUMNS.forEach((col, i) => {
    const cell = reqRow.getCell(i + 1);
    cell.value = col.required ? "Obligatoire" : "Facultatif";
    cell.font = {
      name: "Calibri",
      size: 9,
      bold: col.required,
      italic: !col.required,
      color: { argb: col.required ? COLORS.requiredText : COLORS.optionalText },
    };
    cell.fill = {
      type: "pattern",
      pattern: "solid",
      fgColor: { argb: col.required ? COLORS.requiredBg : COLORS.optionalBg },
    };
    cell.alignment = { horizontal: "center", vertical: "middle" };
    cell.border = BORDER_THIN;
  });

  // ── Ligne 4 : exemple « (ex : ...) » ──
  const exampleRow = ws.getRow(4);
  exampleRow.height = 22;
  COLUMNS.forEach((col, i) => {
    const cell = exampleRow.getCell(i + 1);
    cell.value = col.example ? `(ex : ${col.example})` : "(—)";
    cell.font = { name: "Calibri", size: 9, italic: true, color: { argb: COLORS.inkMuted } };
    const isProductCol = i < PRODUCT_COL_COUNT;
    cell.fill = {
      type: "pattern",
      pattern: "solid",
      fgColor: { argb: isProductCol ? COLORS.productSurface : COLORS.variantSurface },
    };
    cell.alignment = { horizontal: "center", vertical: "middle", wrapText: true };
    cell.border = BORDER_THIN;
  });

  // ── Lignes 5+ : données-exemple ──
  const groupColors = [COLORS.dataRowA, COLORS.dataRowB];
  SAMPLE_DATA.forEach((dataRow, idx) => {
    const excelRow = ws.getRow(5 + idx);
    const groupIdx = getProductGroupIndex(dataRow.reference, SAMPLE_DATA);
    const bgColor = groupColors[groupIdx % 2];

    excelRow.height = 22;
    COLUMNS.forEach((col, i) => {
      const cell = excelRow.getCell(i + 1);
      const raw = (dataRow as Record<string, unknown>)[col.key];
      const value = raw ?? "";
      cell.value = value as ExcelJS.CellValue;

      const isEmpty = value === "" || value === null || value === undefined;
      cell.font = {
        name: "Calibri",
        size: 10,
        color: { argb: isEmpty ? COLORS.inkMuted : COLORS.ink },
        italic: isEmpty,
      };
      cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: bgColor } };
      cell.border = BORDER_THIN;
      cell.alignment = {
        vertical: "middle",
        wrapText: col.key === "description" || col.key === "description_en",
      };

      if (["sale_type", "unit_price", "pack_qty", "stock", "weight_g", "is_primary", "discount_type", "discount_value", "size", "status", "best_seller", "dimension_length", "dimension_width", "dimension_height", "dimension_diameter", "dimension_circumference"].includes(col.key)) {
        cell.alignment = { horizontal: "center", vertical: "middle" };
      }
    });
  });

  // ── Validations par liste (à partir de la ligne 5) ──
  const dataStartRow = 5;
  const dataEndRow = 200;
  const findCol = (key: string) => COLUMNS.findIndex((c) => c.key === key) + 1;

  const saleTypeCol = findCol("sale_type");
  for (let r = dataStartRow; r <= dataEndRow; r++) {
    ws.getCell(r, saleTypeCol).dataValidation = {
      type: "list",
      allowBlank: false,
      formulae: ['"UNIT,PACK"'],
      showErrorMessage: true,
      errorTitle: "Valeur invalide",
      error: "Choisissez UNIT ou PACK",
    };
  }

  const discountTypeCol = findCol("discount_type");
  for (let r = dataStartRow; r <= dataEndRow; r++) {
    ws.getCell(r, discountTypeCol).dataValidation = {
      type: "list",
      allowBlank: true,
      formulae: ['"PERCENT,AMOUNT"'],
      showErrorMessage: true,
      errorTitle: "Valeur invalide",
      error: "Choisissez PERCENT ou AMOUNT (ou laissez vide)",
    };
  }

  const isPrimaryCol = findCol("is_primary");
  for (let r = dataStartRow; r <= dataEndRow; r++) {
    ws.getCell(r, isPrimaryCol).dataValidation = {
      type: "list",
      allowBlank: true,
      formulae: ['"true,"'],
      showErrorMessage: true,
      errorTitle: "Valeur invalide",
      error: 'Indiquez "true" ou laissez vide',
    };
  }

  const statusCol = findCol("status");
  for (let r = dataStartRow; r <= dataEndRow; r++) {
    ws.getCell(r, statusCol).dataValidation = {
      type: "list",
      allowBlank: true,
      formulae: ['"OFFLINE,ONLINE,ARCHIVED"'],
      showErrorMessage: true,
      errorTitle: "Valeur invalide",
      error: "Choisissez OFFLINE, ONLINE ou ARCHIVED (ou laissez vide).",
    };
  }

  const bestSellerCol = findCol("best_seller");
  for (let r = dataStartRow; r <= dataEndRow; r++) {
    ws.getCell(r, bestSellerCol).dataValidation = {
      type: "list",
      allowBlank: true,
      formulae: ['"true,false"'],
      showErrorMessage: true,
      errorTitle: "Valeur invalide",
      error: 'Indiquez "true" ou "false" (ou laissez vide).',
    };
  }

  // Filtre auto sur la ligne des headers
  ws.autoFilter = {
    from: { row: 2, column: 1 },
    to: { row: 2, column: COLUMNS.length },
  };

  const buffer = await wb.xlsx.writeBuffer();

  return new NextResponse(buffer, {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": 'attachment; filename="template-produits-import.xlsx"',
    },
  });
}
