import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import * as ExcelJS from "exceljs";
import {
  getCachedCategories,
  getCachedColors,
  getCachedTags,
  getCachedCompositions,
  getCachedSizes,
  getCachedManufacturingCountries,
  getCachedSeasons,
  getCachedHsCodes,
} from "@/lib/cached-data";

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
  // Grisage conditionnel des cellules "Fiche produit" sur lignes de variantes
  // secondaires (référence vide + couleur remplie)
  inheritedBg: "E5E7EB",  // gray-200
  inheritedText: "9CA3AF",// gray-400
  // Feuille « Valeurs autorisées » — hero & légende
  refHero: "1E293B",        // slate-800 — bandeau titre
  refSubtitleBg: "F8FAFC",  // slate-50 — sous-titre
  refLegendBg: "FFFBEB",    // amber-50 — encart légende
  refLegendBorder: "FCD34D",// amber-300
  refLegendText: "78350F",  // amber-900
};

// ── Palette par colonne pour la feuille « Valeurs autorisées » ──
// Chaque colonne a une couleur d'accent sémantique + une teinte douce
// pour zébrer les lignes. Aligne le ton du cockpit admin.
interface RefPalette {
  header: string;   // fond foncé du header
  zebraEven: string; // ligne paire (légère teinte)
  zebraOdd: string;  // ligne impaire (blanc)
  accent: string;   // texte d'accent (col A — catégories)
}
const REF_PALETTES: RefPalette[] = [
  // A — Catégories (emerald, ancre principale)
  { header: "047857", zebraEven: "ECFDF5", zebraOdd: "FFFFFF", accent: "047857" },
  // B — Sous-catégories (emerald soft)
  { header: "10B981", zebraEven: "F0FDF4", zebraOdd: "FFFFFF", accent: "047857" },
  // C — Tags (violet)
  { header: "6D28D9", zebraEven: "F5F3FF", zebraOdd: "FFFFFF", accent: "6D28D9" },
  // D — Matières / composition (amber)
  { header: "B45309", zebraEven: "FFFBEB", zebraOdd: "FFFFFF", accent: "B45309" },
  // E — Couleurs (rose)
  { header: "BE123C", zebraEven: "FFF1F2", zebraOdd: "FFFFFF", accent: "BE123C" },
  // F — Tailles (stone)
  { header: "57534E", zebraEven: "FAFAF9", zebraOdd: "FFFFFF", accent: "57534E" },
  // G — Pays de fabrication (sky)
  { header: "0369A1", zebraEven: "F0F9FF", zebraOdd: "FFFFFF", accent: "0369A1" },
  // H — Saisons (sky soft)
  { header: "0EA5E9", zebraEven: "F0F9FF", zebraOdd: "FFFFFF", accent: "0369A1" },
  // I — Codes SH (slate)
  { header: "334155", zebraEven: "F8FAFC", zebraOdd: "FFFFFF", accent: "334155" },
  // J — Description code SH (slate soft)
  { header: "64748B", zebraEven: "F8FAFC", zebraOdd: "FFFFFF", accent: "334155" },
];

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
  { key: "name", header: "Nom *", width: 28, required: true, description: "Nom du produit (en français). La traduction anglaise est générée automatiquement à l'import.", example: "Produit Étoile" },
  { key: "description", header: "Description *", width: 38, required: true, description: "Description du produit (en français). La traduction anglaise est générée automatiquement à l'import.", example: "Produit fin avec motif étoile" },
  // — Classement —
  { key: "category", header: "Catégorie *", width: 20, required: true, description: "Doit exister dans la base", example: "Accessoires" },
  { key: "sub_categories", header: "Sous-catégories", width: 22, required: false, description: "Une seule sous-catégorie, choisie dans la liste déroulante filtrée par la catégorie. Vide si la catégorie n'en a pas.", example: "Sautoir" },
  { key: "tags", header: "Tags", width: 26, required: false, description: "Mots-clés séparés par des virgules", example: "étoile,fin,tendance" },
  // — Caractéristiques —
  { key: "composition", header: "Composition *", width: 32, required: true, description: "Matière:% (séparer plusieurs matières par des virgules — la somme des % doit valoir 100)", example: "Coton:80,Polyester:20" },
  { key: "primary_color", header: "Couleur principale", width: 20, required: false, description: "Nom de la couleur affichée par défaut (doit faire partie des variantes)", example: "Doré" },
  { key: "pays_fabrication", header: "Pays fabrication *", width: 18, required: true, description: "Doit exister dans la base", example: "France" },
  { key: "saison", header: "Saison *", width: 16, required: true, description: "Doit exister dans la base", example: "Été 2026" },
  { key: "hs_code", header: "Code SH", width: 14, required: false, description: "Code douanier (doit exister dans Administration > Codes SH)", example: "71171900" },
  // — Dimensions —
  { key: "taille_unique_details", header: "Détail taille unique *", width: 22, required: true, description: "Texte libre décrivant la taille du produit (ex : 52-56, taille unique adulte).", example: "52-56" },
  { key: "dimension_length", header: "Longueur (cm)", width: 16, required: false, description: "Longueur en cm", example: "45" },
  { key: "dimension_width", header: "Largeur (cm)", width: 16, required: false, description: "Largeur en cm", example: "2" },
  { key: "dimension_height", header: "Hauteur (cm)", width: 16, required: false, description: "Hauteur en cm", example: "" },
  { key: "dimension_diameter", header: "Diamètre (cm)", width: 16, required: false, description: "Diamètre en cm", example: "6.5" },
  { key: "dimension_circumference", header: "Circonférence (cm)", width: 20, required: false, description: "Circonférence en cm", example: "" },
  // — Publication & liens —
  // Note : les produits importés arrivent toujours en statut « Hors ligne »
  // (brouillon). La publication se fait ensuite depuis la fiche produit.
  { key: "similar_refs", header: "Réf. similaires", width: 22, required: false, description: "Références produits similaires (virgules)", example: "PRD-002,PRD-003" },
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
  { key: "color", header: "Couleur *", width: 24, required: true, description: "Nom de la couleur (doit exister dans la base). Pour désigner laquelle est principale, renseigner « Couleur principale » dans la fiche produit.", example: "Doré" },
  { key: "sale_type", header: "Type de vente *", width: 15, required: true, description: "UNIT ou PACK", example: "UNIT" },
  { key: "size", header: "Taille *", width: 18, required: true, description: "UNIT : M, 42… PACK : taille:qté (ex: S:2,M:3,L:1). Écrivez « Taille unique » pour le bloc PFS TU.", example: "M" },
  // — Prix & stock —
  { key: "unit_price", header: "Prix unitaire *", width: 15, required: true, description: "Prix HT en euros", example: "12.50" },
  { key: "stock", header: "Stock *", width: 10, required: true, description: "Quantité en stock", example: "200" },
  { key: "pack_qty", header: "Qté pack", width: 12, required: false, description: "Obligatoire si PACK : nombre de pièces dans un paquet (ex : 12). Laissez vide pour UNIT.", example: "12" },
  { key: "discount_type", header: "Type remise", width: 15, required: false, description: "PERCENT (seul type supporté)", example: "PERCENT" },
  { key: "discount_value", header: "Valeur remise", width: 15, required: false, description: "Valeur de la remise en %", example: "10" },
  // — Logistique —
  { key: "weight_kg", header: "Poids (kg) *", width: 12, required: true, description: "Poids en kilogrammes", example: "0.030" },
];

const COLUMNS: ColumnDef[] = [...PRODUCT_COLUMNS, ...VARIANT_COLUMNS];
const PRODUCT_COL_COUNT = PRODUCT_COLUMNS.length;
const VARIANT_COL_COUNT = VARIANT_COLUMNS.length;

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

// ════════════════════════════════════════════════════════════════════
// Feuille de référence — liste tous les noms valides actuellement
// présents en BDD, et sert de source pour les listes déroulantes natives
// d'Excel sur les colonnes mono-valeur (catégorie, couleur, pays, saison,
// code SH). Les colonnes multi-valeurs (sous-catégories, tags, composition,
// taille) gardent une saisie libre mais affichent ces listes comme aide à
// l'orthographe.
//
// Colonnes A/B : une ligne par catégorie principale, avec en B la liste
// des sous-catégories rattachées (séparées par des virgules, comme
// attendu côté import). Permet de voir d'un coup d'œil quelles
// sous-catégories appartiennent à quelle catégorie.
//
// Colonne A=Catégorie, B=Sous-catégories de cette catégorie, C=Tag,
// D=Matière (composition), E=Couleur, F=Taille, G=Pays de fabrication,
// H=Saison, I=Code SH, J=Description du code SH.
// ════════════════════════════════════════════════════════════════════
const REF_SHEET_NAME = "Valeurs autorisées";
// Lignes 1-2 : bandeau hero + sous-titre. Ligne 3 : headers de colonnes.
// Lignes 4+ : données.
const REF_HERO_ROW = 1;
const REF_SUBTITLE_ROW = 2;
const REF_HEADER_ROW = 3;
const REF_DATA_START_ROW = 4;

interface RefColumnSpec {
  index: number;       // 1-based column index in the reference sheet
  letter: string;      // Excel column letter ("A", "B"…)
  header: string;      // Header label
  width: number;
  values: string[];    // Values listed in the column
}

function buildRefColumns(args: {
  categories: string[];
  subCategories: string[];
  tags: string[];
  compositions: string[];
  colors: string[];
  sizes: string[];
  countries: string[];
  seasons: string[];
  hsCodes: Array<{ code: string; label: string }>;
}): RefColumnSpec[] {
  return [
    { index: 1, letter: "A", header: "Catégories",          width: 22, values: args.categories },
    { index: 2, letter: "B", header: "Sous-catégories (de la catégorie en colonne A)", width: 48, values: args.subCategories },
    { index: 3, letter: "C", header: "Tags",                width: 22, values: args.tags },
    { index: 4, letter: "D", header: "Matières (composition)", width: 26, values: args.compositions },
    { index: 5, letter: "E", header: "Couleurs",            width: 22, values: args.colors },
    { index: 6, letter: "F", header: "Tailles",             width: 18, values: args.sizes },
    { index: 7, letter: "G", header: "Pays de fabrication", width: 22, values: args.countries },
    { index: 8, letter: "H", header: "Saisons",             width: 18, values: args.seasons },
    { index: 9, letter: "I", header: "Codes SH",            width: 14, values: args.hsCodes.map((h) => h.code) },
    { index: 10, letter: "J", header: "Description code SH", width: 38, values: args.hsCodes.map((h) => h.label) },
  ];
}

export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session || session.user.role !== "ADMIN") {
    return NextResponse.json({ error: "Non autorisé" }, { status: 401 });
  }

  // ── Données de référence (catégories, couleurs, tags, etc.) ──
  // Source des listes déroulantes et de la feuille « Valeurs autorisées ».
  const [
    categoriesData,
    colorsData,
    tagsData,
    compositionsData,
    sizesData,
    countriesData,
    seasonsData,
    hsCodesData,
  ] = await Promise.all([
    getCachedCategories(),
    getCachedColors(),
    getCachedTags(),
    getCachedCompositions(),
    getCachedSizes(),
    getCachedManufacturingCountries(),
    getCachedSeasons(),
    getCachedHsCodes(),
  ]);

  const categoryNames = categoriesData.map((c) => c.name);
  // Aligné avec categoryNames : une entrée par catégorie, contenant ses
  // sous-catégories triées et jointes par ", " (format d'import attendu).
  // Cellule vide si la catégorie n'a pas de sous-catégorie.
  const subCategoriesByCategory = categoriesData.map((c) =>
    c.subCategories
      .map((sc) => sc.name)
      .sort((a, b) => a.localeCompare(b, "fr"))
      .join(", "),
  );
  const tagNames = tagsData.map((t) => t.name);
  const compositionNames = compositionsData.map((c) => c.name);
  const colorNames = colorsData.map((c) => c.name);
  const sizeNames = sizesData.map((s) => s.name);
  const countryNames = countriesData.map((c) => c.name);
  const seasonNames = seasonsData.map((s) => s.name);
  const hsCodesList = hsCodesData.map((h) => ({ code: h.code, label: h.label }));

  const refColumns = buildRefColumns({
    categories: categoryNames,
    subCategories: subCategoriesByCategory,
    tags: tagNames,
    compositions: compositionNames,
    colors: colorNames,
    sizes: sizeNames,
    countries: countryNames,
    seasons: seasonNames,
    hsCodes: hsCodesList,
  });

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
  //   Ligne 5+ : à remplir par la cliente (modèle livré vide)
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

  // ── Validations par liste (à partir de la ligne 5) ──
  const dataStartRow = 5;
  const dataEndRow = 200;
  const findCol = (key: string) => COLUMNS.findIndex((c) => c.key === key) + 1;

  // ── Style par défaut des cellules de données (toutes lignes 5 → 200) ──
  // Centrage horizontal + vertical, retour à la ligne automatique, police
  // Calibri 11 noire sur fond blanc. Forcer ces propriétés sur chaque
  // cellule garantit un rendu homogène quand la cliente saisit du contenu.
  // Note : Excel pose la limite du « collage avec format source » — un copier
  // venu d'ailleurs amène SA mise en forme. L'astuce conseillée à la cliente
  // est « Coller spécial → Valeurs uniquement » (Ctrl+Shift+V).
  for (let r = dataStartRow; r <= dataEndRow; r++) {
    for (let c = 1; c <= COLUMNS.length; c++) {
      const cell = ws.getCell(r, c);
      cell.alignment = { horizontal: "center", vertical: "middle", wrapText: true };
      cell.font = { name: "Calibri", size: 11, color: { argb: COLORS.ink } };
      cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: COLORS.white } };
    }
  }

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

  // ═══════════════════════════════════════════════════════════════════
  // Feuille « Valeurs autorisées » — référentiel des noms en BDD,
  // alimente les dropdowns des colonnes mono-valeur et sert d'aide à
  // l'orthographe pour les colonnes multi-valeurs.
  // ═══════════════════════════════════════════════════════════════════
  const refSheet = wb.addWorksheet(REF_SHEET_NAME, {
    properties: { tabColor: { argb: COLORS.refHero } },
    views: [{ state: "frozen", ySplit: REF_HEADER_ROW, activeCell: `A${REF_DATA_START_ROW}` }],
  });

  const refLastCol = "J";

  // ── Ligne 1 : bandeau hero ──
  refSheet.mergeCells(`A${REF_HERO_ROW}:${refLastCol}${REF_HERO_ROW}`);
  const heroCell = refSheet.getCell(`A${REF_HERO_ROW}`);
  heroCell.value = "📚   Valeurs autorisées   —   référentiel des données disponibles en base";
  heroCell.font = { name: "Calibri", size: 14, bold: true, color: { argb: COLORS.white } };
  heroCell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: COLORS.refHero } };
  heroCell.alignment = { horizontal: "left", vertical: "middle", indent: 1 };
  refSheet.getRow(REF_HERO_ROW).height = 38;

  // ── Ligne 2 : sous-titre ──
  refSheet.mergeCells(`A${REF_SUBTITLE_ROW}:${refLastCol}${REF_SUBTITLE_ROW}`);
  const subtitleCell = refSheet.getCell(`A${REF_SUBTITLE_ROW}`);
  subtitleCell.value = "Lecture seule  ·  Modifiez ces valeurs depuis l'administration (Produits › Référentiels). Le modèle se mettra à jour au prochain téléchargement.";
  subtitleCell.font = { name: "Calibri", size: 10, italic: true, color: { argb: COLORS.inkSoft } };
  subtitleCell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: COLORS.refSubtitleBg } };
  subtitleCell.alignment = { horizontal: "left", vertical: "middle", indent: 1 };
  refSheet.getRow(REF_SUBTITLE_ROW).height = 22;

  // ── Ligne 3 : headers de colonne (palette sémantique par colonne) ──
  refSheet.getRow(REF_HEADER_ROW).height = 30;
  refColumns.forEach((rc, palIdx) => {
    refSheet.getColumn(rc.index).width = rc.width;
    const palette = REF_PALETTES[palIdx] ?? REF_PALETTES[REF_PALETTES.length - 1];
    const headerCell = refSheet.getCell(REF_HEADER_ROW, rc.index);
    headerCell.value = rc.header;
    headerCell.font = { name: "Calibri", size: 11, bold: true, color: { argb: COLORS.white } };
    headerCell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: palette.header } };
    headerCell.alignment = { horizontal: "center", vertical: "middle", wrapText: true };
    headerCell.border = BORDER_THIN;
  });

  // ── Lignes de données (zébrures + col A en gras coloré) ──
  refColumns.forEach((rc, palIdx) => {
    const palette = REF_PALETTES[palIdx] ?? REF_PALETTES[REF_PALETTES.length - 1];
    const isAnchorCol = rc.index === 1; // Catégories : ancre visuelle
    rc.values.forEach((value, idx) => {
      const cell = refSheet.getCell(REF_DATA_START_ROW + idx, rc.index);
      cell.value = value;
      cell.font = {
        name: "Calibri",
        size: 10,
        bold: isAnchorCol,
        color: { argb: isAnchorCol ? palette.accent : COLORS.ink },
      };
      cell.fill = {
        type: "pattern",
        pattern: "solid",
        fgColor: { argb: idx % 2 === 0 ? palette.zebraEven : palette.zebraOdd },
      };
      cell.alignment = { horizontal: "center", vertical: "middle", wrapText: true };
      cell.border = BORDER_THIN;
    });
  });

  // ── Encart légende (carte ambrée, façon callout) ──
  const legendStart = Math.max(...refColumns.map((rc) => REF_DATA_START_ROW + rc.values.length)) + 2;
  refSheet.mergeCells(`A${legendStart}:${refLastCol}${legendStart}`);
  const legendCell = refSheet.getCell(`A${legendStart}`);
  legendCell.value = "💡  Astuce  —  La feuille Produits propose des listes déroulantes sur Catégorie, Sous-catégorie (filtrée par la catégorie choisie, valeur unique obligatoirement dans la liste), Tags, Taille, Couleur, Couleur principale, Pays, Saison et Code SH. Pour les colonnes multi-valeurs (tags, composition, taille PACK), plusieurs valeurs séparées par des virgules sont autorisées — pour Taille au format « taille:qté » (ex : S:2,M:3). Si une catégorie n'a pas de sous-catégorie en base, la cellule Sous-catégorie correspondante est verrouillée — laissez-la vide. La colonne B ci-contre liste sur chaque ligne les sous-catégories rattachées à la catégorie de la colonne A.  ✂️  Collage depuis un autre fichier : utilisez « Coller spécial → Valeurs uniquement » (Ctrl+Shift+V) pour conserver la mise en forme du modèle.";
  legendCell.font = { name: "Calibri", size: 10, italic: true, color: { argb: COLORS.refLegendText } };
  legendCell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: COLORS.refLegendBg } };
  legendCell.alignment = { horizontal: "left", vertical: "middle", wrapText: true, indent: 1 };
  legendCell.border = {
    top:    { style: "medium", color: { argb: COLORS.refLegendBorder } },
    bottom: { style: "medium", color: { argb: COLORS.refLegendBorder } },
    left:   { style: "medium", color: { argb: COLORS.refLegendBorder } },
    right:  { style: "medium", color: { argb: COLORS.refLegendBorder } },
  };
  refSheet.getRow(legendStart).height = 56;

  // ── Listes déroulantes natives sur les colonnes mono-valeur ──
  // Référence vers la feuille « Valeurs autorisées ». Si la liste est
  // vide (BDD pas encore peuplée), on ne pose pas de validation pour
  // éviter une erreur Excel sur plage vide.
  const sheetRef = `'${REF_SHEET_NAME}'`;
  function buildRangeFormula(letter: string, count: number): string | null {
    if (count <= 0) return null;
    const lastRow = REF_DATA_START_ROW + count - 1;
    return `${sheetRef}!$${letter}$${REF_DATA_START_ROW}:$${letter}$${lastRow}`;
  }

  function attachListValidation(
    columnIndex: number,
    letter: string,
    count: number,
    allowBlank: boolean,
    label: string,
  ) {
    const formula = buildRangeFormula(letter, count);
    if (!formula) return;
    for (let r = dataStartRow; r <= dataEndRow; r++) {
      ws.getCell(r, columnIndex).dataValidation = {
        type: "list",
        allowBlank,
        formulae: [formula],
        showErrorMessage: true,
        errorTitle: "Valeur inconnue",
        error: `${label} : choisissez une valeur dans la liste. Ajoutez-la d'abord dans l'admin si elle manque.`,
      };
    }
  }

  attachListValidation(findCol("category"),         "A", categoryNames.length,  false, "Catégorie");
  attachListValidation(findCol("primary_color"),    "E", colorNames.length,     true,  "Couleur principale");
  attachListValidation(findCol("pays_fabrication"), "G", countryNames.length,   false, "Pays de fabrication");
  attachListValidation(findCol("saison"),           "H", seasonNames.length,    false, "Saison");
  attachListValidation(findCol("hs_code"),          "I", hsCodesList.length,    true,  "Code SH");
  attachListValidation(findCol("color"),            "E", colorNames.length,     false, "Couleur");

  // ── Helper : forcer la cellule à rester vide (liste de référence vide) ──
  // Utilisé quand 0 tag (resp. 0 sous-catégorie) en BDD : la colonne devient
  // inutilisable tant que l'admin n'a pas ajouté de valeurs.
  function attachEmptyOnly(columnIndex: number, errorTitle: string, error: string) {
    for (let r = dataStartRow; r <= dataEndRow; r++) {
      ws.getCell(r, columnIndex).dataValidation = {
        type: "textLength",
        operator: "equal",
        allowBlank: true,
        formulae: [0],
        showErrorMessage: true,
        errorTitle,
        error,
      };
    }
  }

  // ── Tags : flat dropdown (multi-valeur autorisée) ou blocage si 0 tag ──
  const tagsCol = findCol("tags");
  if (tagNames.length === 0) {
    attachEmptyOnly(
      tagsCol,
      "Aucun tag disponible",
      "Aucun tag n'est défini en base. Ajoutez-en d'abord depuis l'admin (Produits › Tags) avant d'utiliser cette colonne.",
    );
  } else {
    const tagsFormula = buildRangeFormula("C", tagNames.length);
    if (tagsFormula) {
      for (let r = dataStartRow; r <= dataEndRow; r++) {
        ws.getCell(r, tagsCol).dataValidation = {
          type: "list",
          allowBlank: true,
          formulae: [tagsFormula],
          // multi-valeur autorisé → on ne bloque pas la saisie libre
          showErrorMessage: false,
          showInputMessage: true,
          promptTitle: "Tags",
          prompt:
            "Cliquez sur la flèche pour voir les tags existants. Pour en saisir plusieurs, tapez-les séparés par des virgules.",
        };
      }
    }
  }

  // ── Tailles : flat dropdown (saisie libre pour le format PACK) ──
  // UNIT  : une seule taille (« M », « 42 »)
  // PACK  : format « taille:qté » séparé par des virgules (« S:2,M:3,L:1 »)
  // Le dropdown sert d'aide-mémoire à l'orthographe ; la saisie libre
  // reste autorisée pour le format PACK.
  const sizeCol = findCol("size");
  if (sizeNames.length === 0) {
    attachEmptyOnly(
      sizeCol,
      "Aucune taille disponible",
      "Aucune taille n'est définie en base. Ajoutez-en d'abord depuis l'admin (Produits › Tailles) avant d'utiliser cette colonne.",
    );
  } else {
    const sizesFormula = buildRangeFormula("F", sizeNames.length);
    if (sizesFormula) {
      for (let r = dataStartRow; r <= dataEndRow; r++) {
        ws.getCell(r, sizeCol).dataValidation = {
          type: "list",
          allowBlank: true,
          formulae: [sizesFormula],
          // multi-valeur / format PACK autorisé → saisie libre non bloquée
          showErrorMessage: false,
          showInputMessage: true,
          promptTitle: "Taille",
          prompt:
            "UNIT : choisissez une taille dans la liste. PACK : tapez les tailles avec quantités au format « taille:qté » séparées par des virgules (ex : S:2,M:3,L:1).",
        };
      }
    }
  }

  // ═══════════════════════════════════════════════════════════════════
  // Dropdown DÉPENDANT pour « Sous-catégories »
  // ───────────────────────────────────────────────────────────────────
  // Excel ne fait pas de multi-select dans une cellule, mais sait faire
  // un dropdown contextuel via INDIRECT() + named ranges. Pour chaque
  // catégorie, on stocke ses sous-catégories en colonne dédiée d'une
  // feuille cachée `_lookup`, et on définit un range nommé
  // `subcats_{nomSanitisé}`. La cellule sub_categories valide alors
  // contre INDIRECT("subcats_" & catégorie sélectionnée).
  //
  // `showErrorMessage: false` autorise la saisie libre (plusieurs
  // sous-catégories séparées par des virgules) — le dropdown sert alors
  // d'aide-mémoire à l'orthographe et permet le picking rapide quand
  // une seule sous-catégorie suffit.
  // ═══════════════════════════════════════════════════════════════════
  function sanitizeRangeName(name: string): string {
    // Espace, apostrophe, tiret → underscore. Les accents (à, é, è, ç…)
    // sont conservés (Excel accepte l'Unicode dans les named ranges).
    return name.replace(/[\s'\-]/g, "_");
  }

  const categoriesWithSubs = categoriesData.filter((c) => c.subCategories.length > 0);
  if (categoriesWithSubs.length > 0) {
    const lookupSheet = wb.addWorksheet("_lookup", { state: "hidden" });

    const usedSafeNames = new Set<string>();
    categoriesWithSubs.forEach((cat, i) => {
      let safeName = sanitizeRangeName(cat.name);
      if (usedSafeNames.has(safeName)) {
        safeName = `${safeName}_${i}`;
      }
      usedSafeNames.add(safeName);

      const lookupColIdx = i + 1;
      const lookupColLet = colLetter(i);

      // Entête lisible dans la feuille cachée (debug / inspection)
      lookupSheet.getCell(1, lookupColIdx).value = cat.name;

      const sortedSubs = cat.subCategories
        .map((sc) => sc.name)
        .sort((a, b) => a.localeCompare(b, "fr"));
      sortedSubs.forEach((sub, j) => {
        lookupSheet.getCell(j + 2, lookupColIdx).value = sub;
      });

      const rangeRef = `'_lookup'!$${lookupColLet}$2:$${lookupColLet}$${sortedSubs.length + 1}`;
      wb.definedNames.add(rangeRef, `subcats_${safeName}`);
    });

    const subCatCol = findCol("sub_categories");
    const categoryColLet = colLetter(findCol("category") - 1);

    for (let r = dataStartRow; r <= dataEndRow; r++) {
      ws.getCell(r, subCatCol).dataValidation = {
        type: "list",
        allowBlank: true,
        formulae: [
          `INDIRECT("subcats_" & SUBSTITUTE(SUBSTITUTE(SUBSTITUTE($${categoryColLet}${r}," ","_"),"'","_"),"-","_"))`,
        ],
        // Validation STRICTE : la valeur doit appartenir à la liste filtrée
        // par la catégorie. Si la catégorie n'a pas de sous-cat, INDIRECT()
        // retourne #REF! → liste vide → toute saisie non vide est rejetée.
        // Une seule sous-catégorie par produit.
        showErrorMessage: true,
        errorTitle: "Sous-catégorie invalide",
        error:
          "Choisissez une sous-catégorie dans la liste déroulante (filtrée par la catégorie). Si la catégorie n'a pas de sous-catégorie, laissez cette cellule vide.",
        showInputMessage: true,
        promptTitle: "Sous-catégorie",
        prompt:
          "Une seule sous-catégorie par produit, choisie dans la liste filtrée par la catégorie sélectionnée. Laissez vide si la catégorie n'a pas de sous-catégorie.",
      };
    }
  } else {
    // Aucune catégorie n'a de sous-catégorie en base — bloquer la colonne.
    attachEmptyOnly(
      findCol("sub_categories"),
      "Aucune sous-catégorie disponible",
      "Aucune sous-catégorie n'est définie en base. Ajoutez-en d'abord depuis l'admin (Produits › Catégories › Sous-catégories) avant d'utiliser cette colonne.",
    );
  }

  // ── Grisage conditionnel des cellules "Fiche produit" ──
  // Quand une ligne a une couleur remplie (variante) MAIS pas de référence,
  // c'est une variante secondaire du produit du dessus : les infos produit
  // sont héritées, inutile de les répéter. Les cellules "Fiche produit" de
  // cette ligne sont grisées automatiquement par Excel. Sur une ligne vide
  // (rien rempli), aucun gris — sinon le modèle blanc serait inondé de gris.
  const refColLetter = colLetter(0);
  const colorColLetter = colLetter(PRODUCT_COL_COUNT); // 1re col de la section Variante
  ws.addConditionalFormatting({
    ref: `${colLetter(0)}${dataStartRow}:${colLetter(PRODUCT_COL_COUNT - 1)}${dataEndRow}`,
    rules: [
      {
        type: "expression",
        priority: 1,
        formulae: [
          `AND(ISBLANK($${refColLetter}${dataStartRow}),NOT(ISBLANK($${colorColLetter}${dataStartRow})))`,
        ],
        style: {
          fill: {
            type: "pattern",
            pattern: "solid",
            bgColor: { argb: COLORS.inheritedBg },
          },
          font: { color: { argb: COLORS.inheritedText } },
        },
      },
    ],
  });

  // ── Surlignage rouge clair de la cellule « Qté pack » quand vide ──
  // Sur les variantes PACK, la colonne Qté pack est obligatoire (validée
  // côté import). On signale visuellement les cellules manquantes en rouge
  // clair pour éviter à la cliente d'attendre l'erreur d'import.
  const saleTypeColLetter = colLetter(findCol("sale_type") - 1);
  const packQtyColLetter = colLetter(findCol("pack_qty") - 1);
  ws.addConditionalFormatting({
    ref: `${packQtyColLetter}${dataStartRow}:${packQtyColLetter}${dataEndRow}`,
    rules: [
      {
        type: "expression",
        priority: 2,
        formulae: [
          `AND($${saleTypeColLetter}${dataStartRow}="PACK",ISBLANK($${packQtyColLetter}${dataStartRow}))`,
        ],
        style: {
          fill: {
            type: "pattern",
            pattern: "solid",
            bgColor: { argb: COLORS.requiredBg },
          },
          font: { color: { argb: COLORS.requiredText }, bold: true },
        },
      },
    ],
  });

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
