#!/usr/bin/env npx tsx
/**
 * Reads the official PFS Excel template (lib/marketplace-excel/templates/pfs-template.xlsx)
 * and generates lib/marketplace-excel/pfs-taxonomy.ts with all reference data.
 *
 * Usage: npx tsx scripts/generate-pfs-taxonomy.ts
 */

import path from "node:path";
import fs from "node:fs";
import ExcelJS from "exceljs";

const TEMPLATE_PATH = path.join(process.cwd(), "lib", "marketplace-excel", "templates", "pfs-template.xlsx");
const OUTPUT_PATH = path.join(process.cwd(), "lib", "marketplace-excel", "pfs-taxonomy.ts");

function cellText(cell: ExcelJS.Cell): string {
  const v = cell.value;
  if (typeof v === "string") return v.trim();
  if (v && typeof v === "object" && "richText" in v) {
    return (v as { richText: { text: string }[] }).richText.map((r) => r.text).join("").trim();
  }
  return "";
}

async function main() {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(TEMPLATE_PATH);

  // ── Categories (Genre + Famille) ──
  const catSheet = wb.getWorksheet("ANNEXE Catégories")!;
  const genders: Record<string, string> = {}; // code → label (WOMAN→Femme)
  const familiesByGender: Record<string, string[]> = {};

  // Row 2: genres (cols 4-7 = Femme, Homme, Enfant, Lifestyle_et_Plus)
  // Rows 3-10: families per genre column
  const genderCols: { col: number; label: string }[] = [];
  for (let c = 4; c <= 7; c++) {
    const label = cellText(catSheet.getRow(2).getCell(c));
    if (label) genderCols.push({ col: c, label });
  }

  // Genre codes from rows 3-6 col B
  const genderCodes: string[] = [];
  for (let r = 3; r <= 6; r++) {
    const code = cellText(catSheet.getRow(r).getCell(2));
    if (code) genderCodes.push(code);
  }

  // Map codes to labels
  const GENDER_CODE_MAP: Record<string, string> = {
    Femme: "WOMAN",
    Homme: "MAN",
    Enfant: "KID",
    Lifestyle_et_Plus: "SUPPLIES",
  };

  for (const gc of genderCols) {
    const code = GENDER_CODE_MAP[gc.label] ?? gc.label;
    genders[code] = gc.label;
    const families: string[] = [];
    // Families are in rows 3-11 (max 9 families per genre), stop at first empty cell
    for (let r = 3; r <= 11; r++) {
      const fam = cellText(catSheet.getRow(r).getCell(gc.col));
      if (!fam) break;
      families.push(fam);
    }
    familiesByGender[gc.label] = families;
  }

  // ── Subcategories per family (row 14 = family headers, row 15+ = subcategories) ──
  const subcategoriesByFamily: Record<string, string[]> = {};
  for (let c = 2; c <= 28; c++) {
    const family = cellText(catSheet.getRow(14).getCell(c));
    if (!family || family === "CATEGORIE") continue;
    const subcats: string[] = [];
    for (let r = 15; r <= catSheet.rowCount; r++) {
      const sub = cellText(catSheet.getRow(r).getCell(c));
      if (sub) subcats.push(sub);
    }
    if (subcats.length > 0) subcategoriesByFamily[family] = subcats;
  }

  // ── Colors ──
  const colorSheet = wb.getWorksheet("ANNEXE Couleurs")!;
  const colors = new Set<string>();
  for (let r = 3; r <= colorSheet.rowCount; r++) {
    for (let c = 1; c <= 25; c++) {
      const text = cellText(colorSheet.getRow(r).getCell(c));
      if (text) colors.add(text);
    }
  }

  // ── Compositions ──
  const gfcSheet = wb.worksheets.find((ws) => ws.name.includes("Genre"))!;
  const compositions = new Set<string>();
  const compHeaders = new Set([
    "Vêtements",
    "Sacs / Ceintures / Gants / Maroquinerie / Chaussures",
    "Bijoux / Montres",
    "Fournitures / Emballages",
  ]);
  for (let col = 1; col <= 4; col++) {
    for (let r = 2; r <= gfcSheet.rowCount; r++) {
      const text = cellText(gfcSheet.getRow(r).getCell(col));
      if (text && !compHeaders.has(text)) compositions.add(text);
    }
  }

  // ── Countries ──
  const paysSheet = wb.getWorksheet("ANNEXE Pays v2")!;
  const countries: string[] = [];
  for (let r = 1; r <= paysSheet.rowCount; r++) {
    const text = cellText(paysSheet.getRow(r).getCell(1));
    if (text) countries.push(text);
  }

  // ── Generate output ──
  const sortedColors = [...colors].sort((a, b) => a.localeCompare(b, "fr"));
  const sortedComps = [...compositions].sort((a, b) => a.localeCompare(b, "fr"));
  const sortedCountries = countries.sort((a, b) => a.localeCompare(b, "fr"));

  const output = `/**
 * PFS taxonomy reference data — auto-generated from "Modèle PFS.xlsx" ANNEXE sheets.
 * DO NOT EDIT MANUALLY — run: npx tsx scripts/generate-pfs-taxonomy.ts
 *
 * Used by MarketplaceMappingSection UI + Excel export.
 */

// ── Genre ──

export const PFS_GENDER_LABELS: Record<string, string> = ${JSON.stringify(genders, null, 2)};

export function pfsGenderLabel(code: string | null | undefined): string {
  if (!code) return "";
  return PFS_GENDER_LABELS[code] ?? code;
}

// ── Familles par genre ──

export const PFS_FAMILIES_BY_GENDER: Record<string, string[]> = ${JSON.stringify(familiesByGender, null, 2)};

// ── Sous-catégories par famille ──

export const PFS_SUBCATEGORIES_BY_FAMILY: Record<string, string[]> = ${JSON.stringify(subcategoriesByFamily, null, 2)};

// ── Couleurs ──

export const PFS_COLORS: string[] = ${JSON.stringify(sortedColors, null, 2)};

// ── Compositions / Matières ──

export const PFS_COMPOSITIONS: string[] = ${JSON.stringify(sortedComps, null, 2)};

// ── Pays de fabrication ──

export const PFS_COUNTRIES: string[] = ${JSON.stringify(sortedCountries, null, 2)};
`;

  fs.writeFileSync(OUTPUT_PATH, output, "utf-8");
  console.log(`✓ Generated ${OUTPUT_PATH}`);
  console.log(`  Genders: ${Object.keys(genders).length}`);
  console.log(`  Families: ${Object.values(familiesByGender).flat().length}`);
  console.log(`  Subcategories: ${Object.values(subcategoriesByFamily).flat().length}`);
  console.log(`  Colors: ${sortedColors.length}`);
  console.log(`  Compositions: ${sortedComps.length}`);
  console.log(`  Countries: ${sortedCountries.length}`);
}

main().catch((err) => {
  console.error("Error:", err);
  process.exit(1);
});
