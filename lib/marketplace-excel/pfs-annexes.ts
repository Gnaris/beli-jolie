/**
 * Reads the PFS Excel template's ANNEXE sheets once and exposes parsed option
 * lists used to populate the admin mapping UI. Module-level cache keyed by
 * file mtime so edits to the template while `next dev` is running refresh
 * automatically without restarting.
 *
 * Sources (all from `lib/marketplace-excel/templates/pfs-template.xlsx`):
 *   - ANNEXE Catégories          → Genre → Famille → Catégorie tree
 *   - ANNEXE Couleurs            → color names grouped by dominant hue
 *   - ANNEXE GenreFamilleCatégorie→ material compositions (4 scopes)
 *   - ANNEXE Pays v2             → flat list of country names
 *   - ANNEXE Tailles v2          → flat unique list of size labels
 *
 * We deliberately flatten complex multi-section annexes (colors, sizes) into
 * simple option lists — the UI just needs valid values, the exact taxonomic
 * relationship is preserved in the workbook itself when uploaded to PFS.
 */

import { statSync } from "node:fs";
import path from "node:path";
import ExcelJS from "exceljs";

const TEMPLATE_PATH = path.join(
  process.cwd(),
  "lib",
  "marketplace-excel",
  "templates",
  "pfs-template.xlsx",
);

export type PfsGender = "Femme" | "Homme" | "Enfant" | "Lifestyle_et_Plus";

export interface PfsFamilyOption {
  gender: PfsGender;
  /** Raw PFS family value — goes straight into the Excel column "Famille". */
  family: string;
}

export interface PfsCategoryOption {
  gender: PfsGender;
  family: string;
  category: string;
}

export interface PfsAnnexes {
  families: PfsFamilyOption[];       // one per (gender, family) pair
  categories: PfsCategoryOption[];   // one per (gender, family, category) triple
  colors: string[];                  // unique sorted color names
  compositions: string[];            // unique sorted material names
  countries: string[];               // unique country names
  sizes: string[];                   // unique size labels (TU, XS, S, 34…)
}

interface CacheEntry {
  mtimeMs: number;
  data: PfsAnnexes;
}

let cache: CacheEntry | null = null;

function cellText(value: unknown): string {
  if (value == null) return "";
  if (typeof value === "string") return value.trim();
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (typeof value === "object") {
    const v = value as Record<string, unknown>;
    if ("richText" in v && Array.isArray(v.richText)) {
      return (v.richText as { text: string }[]).map((t) => t.text).join("").trim();
    }
    if ("result" in v) return cellText(v.result);
    if ("text" in v && typeof v.text === "string") return v.text.trim();
  }
  return "";
}

/**
 * ANNEXE Catégories sheet layout:
 *   Row 13: "FAMILLE" label in col 1, then Genre name in cols 2..28
 *   Row 14: "CATEGORIE" label in col 1, then Famille name in cols 2..28
 *   Row 15+: category names in each column (some cols deeper than others)
 *
 * Each column therefore describes one (Genre, Famille) branch and the
 * non-empty rows below are its categories.
 */
function parseCategories(wb: ExcelJS.Workbook): {
  families: PfsFamilyOption[];
  categories: PfsCategoryOption[];
} {
  const ws = wb.getWorksheet("ANNEXE Catégories");
  if (!ws) return { families: [], categories: [] };

  const GENDER_WHITELIST: Record<string, PfsGender> = {
    Femme: "Femme",
    Homme: "Homme",
    Enfant: "Enfant",
    Lifestyle: "Lifestyle_et_Plus",
    Lifestyle_et_Plus: "Lifestyle_et_Plus",
  };

  const headerGenre = ws.getRow(13);
  const headerFamille = ws.getRow(14);
  const seenFamily = new Set<string>();
  const seenCategory = new Set<string>();
  const families: PfsFamilyOption[] = [];
  const categories: PfsCategoryOption[] = [];

  for (let col = 2; col <= ws.columnCount; col++) {
    const rawGenre = cellText(headerGenre.getCell(col).value);
    const rawFamille = cellText(headerFamille.getCell(col).value);
    const gender = GENDER_WHITELIST[rawGenre];
    if (!gender || !rawFamille) continue;

    const familyKey = `${gender}::${rawFamille}`;
    if (!seenFamily.has(familyKey)) {
      seenFamily.add(familyKey);
      families.push({ gender, family: rawFamille });
    }

    for (let row = 15; row <= ws.rowCount; row++) {
      const category = cellText(ws.getRow(row).getCell(col).value);
      if (!category) continue;
      const catKey = `${gender}::${rawFamille}::${category}`;
      if (seenCategory.has(catKey)) continue;
      seenCategory.add(catKey);
      categories.push({ gender, family: rawFamille, category });
    }
  }

  families.sort((a, b) => a.gender.localeCompare(b.gender) || a.family.localeCompare(b.family));
  categories.sort((a, b) =>
    a.gender.localeCompare(b.gender) ||
    a.family.localeCompare(b.family) ||
    a.category.localeCompare(b.category, "fr"),
  );
  return { families, categories };
}

/**
 * ANNEXE Couleurs: paired columns (hex/label) per hue group starting at row 3.
 * A second block starting around row 18 covers motif names. We flatten
 * everything into a unique sorted list of color/motif labels.
 */
function parseColors(wb: ExcelJS.Workbook): string[] {
  const ws = wb.getWorksheet("ANNEXE Couleurs");
  if (!ws) return [];
  const values = new Set<string>();
  for (let row = 3; row <= ws.rowCount; row++) {
    for (let col = 1; col <= ws.columnCount; col++) {
      const cell = ws.getRow(row).getCell(col);
      const raw = cellText(cell.value);
      if (!raw) continue;
      // Skip banner/group header cells (all uppercase > 3 chars, no lowercase)
      if (raw === raw.toUpperCase() && raw.length > 3 && !/\d/.test(raw)) continue;
      values.add(raw);
    }
  }
  return Array.from(values).sort((a, b) => a.localeCompare(b, "fr"));
}

/**
 * ANNEXE GenreFamilleCatégorie has 4 material lists (Vêtements / Sacs /
 * Bijoux / Fournitures) in cols 1..4 starting at row 2. Col 7 holds side
 * annotations, skipped. We flatten into a unique sorted list.
 */
function parseCompositions(wb: ExcelJS.Workbook): string[] {
  const ws = wb.getWorksheet("ANNEXE GenreFamilleCatégorie & ");
  if (!ws) return [];
  const values = new Set<string>();
  for (let row = 2; row <= ws.rowCount; row++) {
    for (let col = 1; col <= 4; col++) {
      const raw = cellText(ws.getRow(row).getCell(col).value);
      if (!raw) continue;
      values.add(raw);
    }
  }
  return Array.from(values).sort((a, b) => a.localeCompare(b, "fr"));
}

/** ANNEXE Pays v2: single column listing country names. */
function parseCountries(wb: ExcelJS.Workbook): string[] {
  const ws = wb.getWorksheet("ANNEXE Pays v2");
  if (!ws) return [];
  const values = new Set<string>();
  for (let row = 1; row <= ws.rowCount; row++) {
    const raw = cellText(ws.getRow(row).getCell(1).value);
    if (raw) values.add(raw);
  }
  return Array.from(values).sort((a, b) => a.localeCompare(b, "fr"));
}

/**
 * ANNEXE Tailles v2: multi-section matrix. We flatten all non-header cells
 * into a unique sorted list of size labels. Header rows (1-4, 35-37, etc.)
 * mix audience/scope labels that we filter out via a shared label set.
 */
function parseSizes(wb: ExcelJS.Workbook): string[] {
  const ws = wb.getWorksheet("ANNEXE Tailles v2");
  if (!ws) return [];
  // Labels used as SECTION headers (scope/audience/system) — these must not
  // leak into the size list. Short size codes like "TU", "XS", "S" etc. are
  // legitimate values even though they also appear as system row labels.
  // We resolve the ambiguity by checking the row number: rows 2-4 and the
  // sub-section header rows (~20-21, 35-37) are skipped in the loop below.
  const SECTION_LABELS = new Set<string>([
    "Vêtements", "Chaussures", "Chapeau / Bonnet", "Gants", "Ceinture",
    "Bas/Collants", "Chaussettes", "Soutien-gorge", "Anneau", "Chaussons",
    "Enfants", "Enfant", "Adulte", "Adultes",
    "Age", "Taille internationale", "US",
  ]);
  // Rows known to carry section sub-headers rather than size values.
  const HEADER_ROWS = new Set<number>([20, 21, 22, 35, 36, 37]);
  // Rows 2-4 are scope/audience/system headers; skip them.
  const values = new Set<string>();
  for (let row = 5; row <= ws.rowCount; row++) {
    if (HEADER_ROWS.has(row)) continue;
    for (let col = 1; col <= ws.columnCount; col++) {
      const raw = cellText(ws.getRow(row).getCell(col).value);
      if (!raw) continue;
      if (SECTION_LABELS.has(raw)) continue;
      // "FR" also appears as a header in a couple of rows — we keep it out
      // entirely; it is a system label, never a size value.
      if (raw === "FR") continue;
      values.add(raw);
    }
  }
  return Array.from(values).sort((a, b) => {
    const na = Number(a), nb = Number(b);
    if (!isNaN(na) && !isNaN(nb)) return na - nb;
    return a.localeCompare(b, "fr");
  });
}

async function loadFresh(): Promise<PfsAnnexes> {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(TEMPLATE_PATH);
  const cats = parseCategories(wb);
  return {
    families: cats.families,
    categories: cats.categories,
    colors: parseColors(wb),
    compositions: parseCompositions(wb),
    countries: parseCountries(wb),
    sizes: parseSizes(wb),
  };
}

export async function getPfsAnnexes(): Promise<PfsAnnexes> {
  const mtimeMs = statSync(TEMPLATE_PATH).mtimeMs;
  if (cache && cache.mtimeMs === mtimeMs) return cache.data;
  const data = await loadFresh();
  cache = { mtimeMs, data };
  return data;
}

/** Force the next call to re-read the file. Used by tests. */
export function clearPfsAnnexesCache(): void {
  cache = null;
}
