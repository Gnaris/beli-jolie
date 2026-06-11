/**
 * Background Import Processor
 *
 * Processes product CSV and image imports in batches, updating progress in the
 * ImportJob table. Runs as a fire-and-forget async function in the Node.js
 * process — survives client disconnection.
 *
 * Usage:
 *   processProductImport(jobId)   — called after CSV file is saved to disk
 *   processImageImport(jobId)     — called after all image batches are uploaded
 */

import { prisma } from "@/lib/prisma";
import { logger } from "@/lib/logger";
import * as XLSX from "xlsx";
import { readFile, readdir, mkdir } from "fs/promises";
import { processProductImage } from "@/lib/image-processor";
import { productImageDir, productImageBaseName } from "@/lib/storage";
import { emitProductEvent } from "@/lib/product-events";
import { autoTranslateProduct, autoTranslateTag } from "@/lib/auto-translate";
import path from "path";

// ─────────────────────────────────────────────
// Color normalization — accent + case insensitive
// "Doré" = "DORÉ" = "DORE" = "doré"
// ─────────────────────────────────────────────

export function normalizeColorName(name: string): string {
  return name
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, ""); // strip diacritics
}

// ─────────────────────────────────────────────
// Size parsing — "S:2,M:3,L:1" format
// ─────────────────────────────────────────────

export interface ParsedSizeEntry {
  name: string;
  quantity: number;
}

/**
 * Parse size field from import file.
 * - UNIT: "M" or "42" → [{ name: "M", quantity: 1 }]
 * - PACK: "S:2,M:3,L:1" → [{ name: "S", quantity: 2 }, { name: "M", quantity: 3 }, { name: "L", quantity: 1 }]
 * - PACK: "M" (no qty) → [{ name: "M", quantity: 1 }]
 */
export function parseSizeField(sizeStr: string | undefined, saleType: "UNIT" | "PACK"): ParsedSizeEntry[] {
  if (!sizeStr || !sizeStr.trim()) return [];
  const raw = sizeStr.trim();

  if (saleType === "UNIT") {
    // UNIT: single size, quantity always 1
    return [{ name: raw, quantity: 1 }];
  }

  // PACK: "S:2,M:3,L:1" or just "M" (defaults to qty 1)
  const parts = raw.split(",").map((p) => p.trim()).filter(Boolean);
  const entries: ParsedSizeEntry[] = [];
  for (const part of parts) {
    const [name, qtyStr] = part.split(":").map((s) => s.trim());
    if (!name) continue;
    const qty = qtyStr ? parseInt(qtyStr) : 1;
    entries.push({ name, quantity: isNaN(qty) || qty < 1 ? 1 : qty });
  }
  return entries;
}

// ─────────────────────────────────────────────
// Types (mirrored from import route)
// ─────────────────────────────────────────────

export interface ProductImportRow {
  _rowIndex: number;
  reference: string;
  name: string;
  description?: string;
  category?: string;
  subCategories?: string;   // comma-separated sub-category names
  color: string;
  saleType: "UNIT" | "PACK";
  unitPrice: number;
  packQuantity?: number;
  stock: number;
  weight?: number;
  discountPercent?: number;
  size?: string;
  tags?: string;
  composition?: string;
  similarRefs?: string;     // comma-separated references of similar products
  manufacturingCountry?: string;  // country name
  season?: string;                // season name
  dimensionLength?: number;
  dimensionWidth?: number;
  dimensionHeight?: number;
  dimensionDiameter?: number;
  dimensionCircumference?: number;
  // Niveau produit, ajoutés mai 2026 pour aligner l'import sur le formulaire manuel
  hsCode?: string;                // code SH (6-10 chiffres)
  primaryColor?: string;          // nom de la couleur principale (doit faire partie des variantes)
  sizeDetailsTu?: string;         // détail texte libre quand une variante utilise « Taille unique »
  isBestSeller?: boolean;
}

interface DraftProductRow extends ProductImportRow {
  errors: string[];
}

// ─────────────────────────────────────────────
// Overrides venant de l'UI éditable du récapitulatif
// ─────────────────────────────────────────────

export interface VariantOverridePayload {
  color?: string;
  saleType?: "UNIT" | "PACK";
  unitPrice?: number;
  stock?: number;
  size?: string;
  packQuantity?: number | null;
}

export interface ImportOverride {
  name?: string;
  description?: string;
  category?: string;
  subCategories?: string;
  tags?: string;
  composition?: string;
  primaryColor?: string;
  manufacturingCountry?: string;
  season?: string;
  hsCode?: string;
  sizeDetailsTu?: string;
  similarRefs?: string;
  isBestSeller?: boolean;
  dimensionLength?: number | null;
  dimensionWidth?: number | null;
  dimensionHeight?: number | null;
  dimensionDiameter?: number | null;
  dimensionCircumference?: number | null;
  /** Map index variante → patch (index = position dans le groupe Excel = ordre d'apparition). */
  variants?: Record<number, VariantOverridePayload>;
}

const PRODUCT_OVERRIDE_FIELDS = [
  "name", "description", "category", "subCategories",
  "tags", "composition", "primaryColor", "manufacturingCountry", "season",
  "hsCode", "sizeDetailsTu", "similarRefs", "isBestSeller",
  "dimensionLength", "dimensionWidth", "dimensionHeight", "dimensionDiameter",
  "dimensionCircumference",
] as const;

const VARIANT_OVERRIDE_FIELDS = ["color", "saleType", "unitPrice", "stock", "size", "packQuantity"] as const;

/**
 * Applique les overrides aux rows groupées par référence. Les champs produit-level
 * sont posés sur toutes les rows du groupe (pour résister à l'héritage), les
 * champs variant-level sont posés sur la row à l'index donné.
 */
export function applyOverrides(
  preGrouped: Map<string, ProductImportRow[]>,
  overrides: Record<string, ImportOverride>,
): void {
  for (const [ref, override] of Object.entries(overrides)) {
    const groupRows = preGrouped.get(ref.toUpperCase());
    if (!groupRows) continue;

    // Champs produit-level : appliquer à toutes les rows
    for (const field of PRODUCT_OVERRIDE_FIELDS) {
      const val = override[field];
      if (val === undefined) continue;
      for (const row of groupRows) {
        (row as unknown as Record<string, unknown>)[field] = val;
      }
    }

    // Champs variant-level : appliquer à la row à l'index correspondant
    if (override.variants) {
      for (const [idxStr, vOv] of Object.entries(override.variants)) {
        const idx = parseInt(idxStr);
        const target = groupRows[idx];
        if (!target) continue;
        for (const field of VARIANT_OVERRIDE_FIELDS) {
          const val = vOv[field];
          if (val === undefined) continue;
          (target as unknown as Record<string, unknown>)[field] = val;
        }
      }
    }
  }
}

interface ImageFileInfo {
  filename: string;
  reference: string;
  color: string;
  position: number;
  /** true if the user explicitly chose this position in the preview UI (override). */
  positionOverridden: boolean;
  filePath: string; // absolute path on disk
}

interface ImageDraftRow {
  filename: string;
  reference: string;
  color: string;
  position: number;
  tempPath: string;
  errors: string[];
  productId?: string;
  colorId?: string;
  availableColors?: { id: string; name: string; hex: string; patternImage?: string | null }[];
  availableRefs?: string[];
}

// ─────────────────────────────────────────────
// Product parsing (same logic as import route)
// ─────────────────────────────────────────────

/** Lit un booléen tolérant : "true"/"1"/"oui" => true ; "false"/"0"/"non"/"" => false. */
export function boolish(raw: unknown): boolean | undefined {
  if (raw === undefined || raw === null) return undefined;
  const s = String(raw).trim().toLowerCase();
  if (s === "") return undefined;
  if (["true", "1", "oui", "yes", "vrai", "x"].includes(s)) return true;
  if (["false", "0", "non", "no", "faux"].includes(s)) return false;
  return undefined;
}

/** Lit un statut produit autorisé (OFFLINE / ONLINE / ARCHIVED). SYNCING n'est pas
 *  exposé à l'import — c'est un état système géré par la sync marketplace. */
export function readStatus(raw: unknown): "OFFLINE" | "ONLINE" | "ARCHIVED" | undefined {
  if (raw === undefined || raw === null) return undefined;
  const s = String(raw).trim().toUpperCase();
  if (s === "" ) return undefined;
  // Aliases FR
  if (["EN LIGNE", "ONLINE", "PUBLIE", "PUBLIÉ"].includes(s)) return "ONLINE";
  if (["HORS LIGNE", "OFFLINE", "BROUILLON"].includes(s)) return "OFFLINE";
  if (["ARCHIVE", "ARCHIVÉ", "ARCHIVED"].includes(s)) return "ARCHIVED";
  if (s === "OFFLINE" || s === "ONLINE" || s === "ARCHIVED") return s;
  return undefined;
}

function normalizeRow(raw: Record<string, unknown>, index: number): ProductImportRow {
  const str = (v: unknown) => (v != null ? String(v).trim() : "");
  const num = (v: unknown) => {
    const n = parseFloat(String(v ?? "").replace(",", "."));
    return isNaN(n) ? undefined : n;
  };
  const int = (v: unknown) => {
    const n = parseInt(String(v ?? ""));
    return isNaN(n) ? undefined : n;
  };

  // Support French headers from template (e.g. "Référence *", "Nom *") + English keys
  const saleTypeRaw = str(raw["sale_type"] ?? raw["sale_type *"] ?? raw["saleType"] ?? raw["type_vente"] ?? raw["Type de vente *"] ?? "UNIT").toUpperCase();

  return {
    _rowIndex: index + 2,
    reference: str(raw["reference"] ?? raw["reference *"] ?? raw["ref"] ?? raw["référence"] ?? raw["Référence *"]),
    name: str(raw["name"] ?? raw["name *"] ?? raw["nom"] ?? raw["name_fr"] ?? raw["Nom *"]),
    description: str(raw["description"] ?? raw["description *"] ?? raw["description_fr"] ?? raw["Description"] ?? raw["Description *"]) || undefined,
    category: str(raw["category"] ?? raw["category *"] ?? raw["categorie"] ?? raw["catégorie"] ?? raw["Catégorie"] ?? raw["Catégorie *"]) || undefined,
    color: str(raw["color"] ?? raw["color *"] ?? raw["couleur"] ?? raw["Couleur *"]),
    saleType: saleTypeRaw === "PACK" ? "PACK" : "UNIT",
    unitPrice: num(raw["unit_price"] ?? raw["unit_price *"] ?? raw["prix"] ?? raw["price"] ?? raw["Prix unitaire *"]) ?? 0,
    packQuantity: int(raw["pack_qty"] ?? raw["pack_quantity"] ?? raw["quantite_pack"] ?? raw["Qté pack"]),
    stock: int(raw["stock"] ?? raw["stock *"] ?? raw["quantite"] ?? raw["qty"] ?? raw["Stock *"]) ?? 0,
    weight: num(raw["weight_g"] ?? raw["poids_g"] ?? raw["poids"] ?? raw["Poids (g)"]) ?? undefined,
    discountPercent: num(raw["discount_percent"] ?? raw["remise_percent"] ?? raw["Remise %"] ?? raw["discount_value"] ?? raw["remise_valeur"] ?? raw["Valeur remise"]),
    size: str(raw["size"] ?? raw["size *"] ?? raw["taille"] ?? raw["Taille"] ?? raw["Taille *"]) || undefined,
    tags: str(raw["tags"] ?? raw["Tags"]) || undefined,
    composition: str(raw["composition"] ?? raw["composition *"] ?? raw["Composition"] ?? raw["Composition *"]) || undefined,
    subCategories: str(raw["sub_categories"] ?? raw["sous_categories"] ?? raw["subCategories"] ?? raw["Sous-catégories"]) || undefined,
    similarRefs: str(raw["similar_refs"] ?? raw["produits_similaires"] ?? raw["similarRefs"] ?? raw["Réf. similaires"]) || undefined,
    dimensionLength: num(raw["dimension_length"] ?? raw["longueur"] ?? raw["Longueur (cm)"]),
    dimensionWidth: num(raw["dimension_width"] ?? raw["largeur"] ?? raw["Largeur (cm)"]),
    dimensionHeight: num(raw["dimension_height"] ?? raw["hauteur"] ?? raw["Hauteur (cm)"]),
    dimensionDiameter: num(raw["dimension_diameter"] ?? raw["diametre"] ?? raw["diamètre"] ?? raw["Diamètre (cm)"]),
    dimensionCircumference: num(raw["dimension_circumference"] ?? raw["circonference"] ?? raw["circonférence"] ?? raw["Circonférence (cm)"]),
    manufacturingCountry: str(raw["manufacturing_country"] ?? raw["pays_fabrication"] ?? raw["pays_fabrication *"] ?? raw["pays"] ?? raw["Pays fabrication"] ?? raw["Pays fabrication *"]) || undefined,
    season: str(raw["season"] ?? raw["season *"] ?? raw["saison"] ?? raw["saison *"] ?? raw["collection"] ?? raw["Saison"] ?? raw["Saison *"]) || undefined,
    hsCode: str(raw["hs_code"] ?? raw["code_sh"] ?? raw["hsCode"] ?? raw["Code SH"]) || undefined,
    primaryColor: str(raw["primary_color"] ?? raw["couleur_principale"] ?? raw["primaryColor"] ?? raw["Couleur principale"]) || undefined,
    sizeDetailsTu: str(raw["taille_unique_details"] ?? raw["detail_taille_unique"] ?? raw["sizeDetailsTu"] ?? raw["Détail taille unique *"] ?? raw["Détail taille unique"]) || undefined,
    isBestSeller: boolish(raw["best_seller"] ?? raw["isBestSeller"] ?? raw["bestseller"] ?? raw["Best Seller"]),
  };
}

export function parseExcel(buffer: Buffer): ProductImportRow[] {
  const wb = XLSX.read(buffer, { type: "buffer" });
  // Use "Produits" sheet if it exists, fallback to first sheet
  const ws = wb.Sheets["Produits"] ?? wb.Sheets[wb.SheetNames[0]];

  // Structure du template (depuis juin 2026) :
  //   Ligne 1 : bandeaux de section fusionnés (« Fiche produit », « Variante »)
  //   Ligne 2 : headers
  //   Ligne 3 : exemples « (ex : ...) » en italique gris
  //   Ligne 4+ : données
  //
  // Détection nouveau vs ancien format : on regarde A1 — si c'est un bandeau de
  // section (contient « Fiche produit » ou « Variante »), on utilise `range: 1`
  // pour lire les headers depuis la ligne 2. Sinon ancien format (headers ligne 1).
  const cellA1 = ws["A1"];
  const a1Text = cellA1 && typeof cellA1.v === "string" ? cellA1.v : "";
  const isNewFormat = /fiche produit|variante/i.test(a1Text);
  const data = XLSX.utils.sheet_to_json<Record<string, unknown>>(ws, {
    defval: "",
    range: isNewFormat ? 1 : 0,
  });

  // Filtrer : ligne « Obligatoire / Facultatif », ligne d'exemples « (ex : ...) »,
  // anciennes descriptions de header, et lignes complètement vides.
  // Les lignes avec référence vide mais couleur remplie héritent de la référence
  // précédente — on les conserve.
  const filtered = data.filter((row) => {
    const ref = String(row["reference"] ?? row["reference *"] ?? row["ref"] ?? row["référence"] ?? row["Référence *"] ?? "").trim();
    const refLow = ref.toLowerCase();
    if (refLow === "obligatoire" || refLow === "facultatif") return false; // ligne statut
    if (refLow.startsWith("(ex")) return false; // ligne d'exemples
    if (refLow.startsWith("référence unique") || refLow.startsWith("reference unique")) return false;
    const saleType = String(row["sale_type"] ?? row["sale_type *"] ?? row["saleType"] ?? row["Type de vente *"] ?? "").trim().toUpperCase();
    if (saleType && saleType !== "UNIT" && saleType !== "PACK" && saleType.length > 10) return false;
    const color = String(row["color"] ?? row["color *"] ?? row["couleur"] ?? row["Couleur *"] ?? "").trim();
    const colorLow = color.toLowerCase();
    if (colorLow === "obligatoire" || colorLow === "facultatif") return false; // ligne statut (au cas où ref serait vide)
    if (colorLow.startsWith("(ex")) return false; // ligne d'exemples
    if (!ref && !color) return false; // ligne complètement vide
    return true;
  });

  return filtered.map((row, i) => normalizeRow(row, i));
}

/** Validate a single variant row. Product-level fields (name, category) are
 *  checked separately after grouping, so only variant-level fields are validated here. */
function validateVariantRow(row: ProductImportRow): string[] {
  const errors: string[] = [];
  if (!row.reference) errors.push("Référence manquante.");
  if (!row.color) errors.push("Couleur manquante.");
  if (!["UNIT", "PACK"].includes(row.saleType)) errors.push("Type de vente invalide (UNIT ou PACK).");
  if (!row.size) errors.push("Taille obligatoire.");
  if (!row.unitPrice || row.unitPrice <= 0) errors.push("Prix unitaire invalide.");
  if (row.stock == null || row.stock < 0) errors.push("Stock invalide.");
  // Validate size format for PACK
  if (row.saleType === "PACK" && row.size) {
    const parsed = parseSizeField(row.size, "PACK");
    if (parsed.length === 0) errors.push("Format de taille invalide pour PACK (ex: S:2,M:3,L:1).");
    const totalQty = parsed.reduce((sum, e) => sum + e.quantity, 0);
    if (totalQty < 1) errors.push("La quantité totale du pack doit être ≥ 1.");
    // packQuantity is auto-computed from sizes, no longer required in file
  } else if (row.saleType === "PACK" && !row.size) {
    // Already caught by "Taille obligatoire" above
  }

  return errors;
}

// ─────────────────────────────────────────────
// PRODUCT IMPORT — Background processor
// ─────────────────────────────────────────────

const PRODUCT_BATCH_SIZE = 50; // products (not rows) per batch

export async function processProductImport(jobId: string, maxProducts?: number): Promise<void> {
  try {
    const job = await prisma.importJob.findUnique({ where: { id: jobId } });
    if (!job || !job.filePath) throw new Error("Job introuvable.");

    // Mark as processing
    await prisma.importJob.update({ where: { id: jobId }, data: { status: "PROCESSING" } });

    // Read & parse file (filePath stored as relative in DB)
    const filePathAbsolute = path.resolve(process.cwd(), job.filePath);
    const buffer = await readFile(filePathAbsolute);
    const rows: ProductImportRow[] = parseExcel(buffer);

    // Lire les overrides éventuels envoyés depuis l'UI éditable du récapitulatif.
    // Format JSON : Record<reference, ProductOverride> — voir EditableProductCard.tsx.
    // On les applique APRÈS propagation de référence (juste en dessous), avant
    // la validation pour que les modifs (catégorie créée à la volée, prix corrigé,
    // etc.) soient considérées comme la vraie donnée à importer.
    let overrides: Record<string, ImportOverride> = {};
    try {
      const overridesPath = `${filePathAbsolute}.overrides.json`;
      const overridesText = await readFile(overridesPath, "utf-8");
      overrides = JSON.parse(overridesText);
    } catch {
      // Pas de fichier overrides — c'est OK, on importe le fichier brut
    }

    // Update total
    // Propagate reference from previous row when empty (Excel users often only fill
    // the reference on the first row of a multi-variant product)
    let lastRef = "";
    for (const row of rows) {
      if (row.reference) {
        lastRef = row.reference;
      } else if (lastRef) {
        row.reference = lastRef;
      }
    }

    // Group by reference FIRST, then inherit product-level fields from first row,
    // then validate. This allows multi-row products (same reference) where only the
    // first row has the name/description/category filled in.
    const preGrouped = new Map<string, ProductImportRow[]>();
    for (const row of rows) {
      if (!row.reference) continue; // skip rows without reference entirely
      const ref = row.reference.toUpperCase();
      if (!preGrouped.has(ref)) preGrouped.set(ref, []);
      preGrouped.get(ref)!.push(row);
    }

    // Inherit product-level fields from the group: find the first row that has each
    // field and propagate to all rows. This handles cases where product-level fields
    // (name, category, composition, etc.) are on any row, not just the first.
    const productFields = ["name", "description", "category", "tags", "composition", "subCategories", "similarRefs", "manufacturingCountry", "season", "dimensionLength", "dimensionWidth", "dimensionHeight", "dimensionDiameter", "dimensionCircumference", "hsCode", "primaryColor", "sizeDetailsTu", "isBestSeller"] as const;
    for (const [, groupRows] of preGrouped) {
      for (const field of productFields) {
        // Find the first row that has this field
        const source = groupRows.find((r) => r[field]);
        if (!source) continue;
        for (const row of groupRows) {
          if (!row[field] && source[field]) {
            (row as unknown as Record<string, unknown>)[field] = source[field];
          }
        }
      }
    }

    // Appliquer les overrides de l'UI éditable AVANT validation. Les valeurs
    // produit-level vont sur toutes les rows du groupe (sinon perdues à l'héritage),
    // les valeurs variant-level vont sur la row à l'index correspondant.
    applyOverrides(preGrouped, overrides);

    const grouped = new Map<string, ProductImportRow[]>();
    const errorRows: DraftProductRow[] = [];

    // Valider d'abord les champs au niveau produit (sur la 1ʳᵉ ligne, qui porte
    // les valeurs héritées par tout le groupe). Si un champ obligatoire manque,
    // toutes les lignes du groupe sont marquées en erreur avec le détail.
    for (const [ref, groupRows] of preGrouped) {
      const first = groupRows[0];
      const productErrors: string[] = [];
      if (!first.name) productErrors.push("Nom manquant.");
      if (!first.description) productErrors.push("Description manquante.");
      if (!first.category) productErrors.push("Catégorie manquante.");
      if (!first.composition) productErrors.push("Composition manquante.");
      if (!first.manufacturingCountry) productErrors.push("Pays de fabrication manquant.");
      if (!first.season) productErrors.push("Saison manquante.");
      if (groupRows.length === 0) productErrors.push("Au moins une variante requise.");

      if (productErrors.length > 0) {
        for (const row of groupRows) {
          errorRows.push({ ...row, errors: productErrors });
        }
        continue;
      }

      for (const row of groupRows) {
        const errs = validateVariantRow(row);
        if (errs.length > 0) {
          errorRows.push({ ...row, errors: errs });
          continue;
        }
        if (!grouped.has(ref)) grouped.set(ref, []);
        grouped.get(ref)!.push(row);
      }
    }

    // Apply maxProducts limit — only keep first N product groups
    if (maxProducts && maxProducts > 0 && grouped.size > maxProducts) {
      const keys = [...grouped.keys()];
      for (let k = maxProducts; k < keys.length; k++) {
        grouped.delete(keys[k]);
      }
      logger.info("[import/products] Limited to maxProducts", { maxProducts, totalInFile: keys.length, kept: grouped.size });
    }

    const totalProducts = grouped.size;
    await prisma.importJob.update({
      where: { id: jobId },
      data: {
        totalItems: totalProducts,
        errorItems: errorRows.length,
        resultDetails: {
          type: "PRODUCTS",
          errorPreview: buildProductErrorPreview(errorRows),
        } as unknown as import("@prisma/client").Prisma.JsonObject,
      },
    });

    // Pre-load reference data
    const allValidRows = [...grouped.values()].flat();
    // Split multi-colors "Bleu/Rose/Vert" into individual color names
    const colorNames = [...new Set(
      allValidRows.flatMap((r) => r.color ? r.color.split("/").map((c) => c.trim()).filter(Boolean) : [])
    )];
    const categoryNames = [...new Set(allValidRows.filter((r) => r.category).map((r) => r.category!))];
    const tagNames = [
      ...new Set(
        allValidRows.flatMap((r) =>
          r.tags ? r.tags.split(",").map((t) => t.trim()).filter(Boolean) : []
        )
      ),
    ];
    const compositionMaterials = [
      ...new Set(
        allValidRows.flatMap((r) =>
          r.composition ? r.composition.split(",").map((c) => c.split(":")[0].trim()).filter(Boolean) : []
        )
      ),
    ];

    // Collect sub-category names
    const subCatNames = [
      ...new Set(
        allValidRows.flatMap((r) =>
          r.subCategories ? r.subCategories.split(",").map((s) => s.trim()).filter(Boolean) : []
        )
      ),
    ];

    const countryNames = [...new Set(allValidRows.filter((r) => r.manufacturingCountry).map((r) => r.manufacturingCountry!))];
    const seasonNames = [...new Set(allValidRows.filter((r) => r.season).map((r) => r.season!))];
    const hsCodes = [...new Set(allValidRows.filter((r) => r.hsCode).map((r) => r.hsCode!.trim()))];

    const [dbColors, dbCategories, dbTags, dbCompositions, dbSubCategories, dbCountries, dbSeasons, dbHsCodes, existingProducts] = await Promise.all([
      prisma.color.findMany({ where: { name: { in: colorNames } } }),
      prisma.category.findMany({ where: { name: { in: categoryNames } } }),
      prisma.tag.findMany({ where: { name: { in: tagNames } } }),
      prisma.composition.findMany({ where: { name: { in: compositionMaterials } } }),
      prisma.subCategory.findMany(),
      prisma.manufacturingCountry.findMany({ where: { name: { in: countryNames } } }),
      prisma.season.findMany({ where: { name: { in: seasonNames } } }),
      hsCodes.length > 0
        ? prisma.hsCode.findMany({ where: { code: { in: hsCodes } }, select: { id: true, code: true } })
        : Promise.resolve([] as { id: string; code: string }[]),
      prisma.product.findMany({ where: { reference: { in: [...grouped.keys()] } }, select: { reference: true } }),
    ]);

    const colorMap = new Map(dbColors.map((c) => [normalizeColorName(c.name), c]));
    const categoryMap = new Map(dbCategories.map((c) => [c.name.toLowerCase(), c]));
    const tagMap = new Map(dbTags.map((t) => [t.name.toLowerCase(), t]));
    const compositionMap = new Map(dbCompositions.map((c) => [c.name.toLowerCase(), c]));
    const subCatMap = new Map(dbSubCategories.map((s) => [s.name.toLowerCase(), s]));
    const countryMap = new Map(dbCountries.map((c) => [c.name.toLowerCase(), c]));
    const seasonMap = new Map(dbSeasons.map((s) => [s.name.toLowerCase(), s]));
    const hsCodeMap = new Map(dbHsCodes.map((h) => [h.code.trim(), h]));
    const existingRefs = new Set(existingProducts.map((p) => p.reference.toUpperCase()));

    let successCount = 0;
    let processedCount = 0;
    const entries = [...grouped.entries()];

    // Collect detailed results for history display
    const createdProducts: {
      reference: string;
      name: string;
      category?: string;
      variants: { color: string; saleType: string; unitPrice: number; stock: number; packQuantity?: number | null }[];
    }[] = [];

    // Process in batches
    for (let i = 0; i < entries.length; i += PRODUCT_BATCH_SIZE) {
      const batch = entries.slice(i, i + PRODUCT_BATCH_SIZE);

      for (const [ref, colorRows] of batch) {
        // Check existing
        if (existingRefs.has(ref)) {
          for (const row of colorRows) {
            errorRows.push({ ...row, errors: [`La référence "${ref}" existe déjà.`] });
          }
          processedCount++;
          continue;
        }

        // Resolve colors — une seule couleur par variante.
        const resolvedColors: {
          row: ProductImportRow;
          mainColor: (typeof dbColors)[0];
        }[] = [];
        for (const row of colorRows) {
          const colorName = row.color.trim();
          if (!colorName) {
            errorRows.push({ ...row, errors: [`Couleur manquante.`] });
            continue;
          }
          const dbColor = colorMap.get(normalizeColorName(colorName));
          if (!dbColor) {
            errorRows.push({ ...row, errors: [`Couleur introuvable : ${colorName}`] });
            continue;
          }
          resolvedColors.push({ row, mainColor: dbColor });
        }

        if (resolvedColors.length === 0) { processedCount++; continue; }

        const firstRow = colorRows[0];

        // Category
        let categoryId: string | undefined;
        if (firstRow.category) {
          const cat = categoryMap.get(firstRow.category.toLowerCase());
          if (!cat) {
            for (const row of colorRows) {
              if (!errorRows.some((e) => e._rowIndex === row._rowIndex)) {
                errorRows.push({ ...row, errors: [`Catégorie "${firstRow.category}" introuvable.`] });
              }
            }
            processedCount++;
            continue;
          }
          categoryId = cat.id;
        }

        // Tags
        const rowTagNames = firstRow.tags
          ? firstRow.tags.split(",").map((t) => t.trim()).filter(Boolean)
          : [];
        const tagIds: string[] = [];
        for (const tName of rowTagNames) {
          const t = tagMap.get(tName.toLowerCase());
          if (t) {
            tagIds.push(t.id);
          } else {
            const newTag = await prisma.tag.upsert({
              where: { name: tName },
              update: {},
              create: { name: tName },
            });
            tagIds.push(newTag.id);
            // Fire-and-forget auto-translation for new tags
            autoTranslateTag(newTag.id, tName);
          }
        }

        // Compositions — error if not found
        const compPairs: { compositionId: string; percentage: number }[] = [];
        let compError = false;
        if (firstRow.composition) {
          for (const part of firstRow.composition.split(",")) {
            const [material, pct] = part.split(":").map((s) => s.trim());
            const comp = compositionMap.get(material.toLowerCase());
            if (comp) {
              compPairs.push({ compositionId: comp.id, percentage: parseFloat(pct) || 0 });
            } else if (material) {
              for (const row of colorRows) {
                if (!errorRows.some((e) => e._rowIndex === row._rowIndex)) {
                  errorRows.push({ ...row, errors: [`Composition "${material}" introuvable.`] });
                }
              }
              compError = true;
            }
          }
        }
        if (compError) { processedCount++; continue; }

        // Sub-categories — error if not found
        // Prefer sub-category from the same category, fallback to any match by name
        const subCatIds: string[] = [];
        let subCatError = false;
        if (firstRow.subCategories) {
          for (const scName of firstRow.subCategories.split(",").map((s) => s.trim()).filter(Boolean)) {
            const scLower = scName.toLowerCase();
            // Prefer match in the same category
            const sc = dbSubCategories.find(
              (s) => s.name.toLowerCase() === scLower && (categoryId ? s.categoryId === categoryId : true)
            ) ?? dbSubCategories.find((s) => s.name.toLowerCase() === scLower);
            if (sc) {
              subCatIds.push(sc.id);
            } else {
              for (const row of colorRows) {
                if (!errorRows.some((e) => e._rowIndex === row._rowIndex)) {
                  errorRows.push({ ...row, errors: [`Sous-catégorie "${scName}" introuvable.`] });
                }
              }
              subCatError = true;
            }
          }
        }
        if (subCatError) { processedCount++; continue; }

        // Similar refs to link
        const similarRefsList = firstRow.similarRefs
          ? firstRow.similarRefs.split(",").map((s) => s.trim().toUpperCase()).filter(Boolean)
          : [];

        // Manufacturing country — error if not found
        let manufacturingCountryId: string | null = null;
        if (firstRow.manufacturingCountry) {
          const country = countryMap.get(firstRow.manufacturingCountry.toLowerCase());
          if (country) {
            manufacturingCountryId = country.id;
          } else {
            for (const row of colorRows) {
              if (!errorRows.some((e) => e._rowIndex === row._rowIndex)) {
                errorRows.push({ ...row, errors: [`Pays de fabrication "${firstRow.manufacturingCountry}" introuvable.`] });
              }
            }
            processedCount++;
            continue;
          }
        }

        // Season — error if not found
        let seasonId: string | null = null;
        if (firstRow.season) {
          const season = seasonMap.get(firstRow.season.toLowerCase());
          if (season) {
            seasonId = season.id;
          } else {
            for (const row of colorRows) {
              if (!errorRows.some((e) => e._rowIndex === row._rowIndex)) {
                errorRows.push({ ...row, errors: [`Saison "${firstRow.season}" introuvable.`] });
              }
            }
            processedCount++;
            continue;
          }
        }

        // Code SH — error if specified but not found in HsCode library
        let hsCodeId: string | null = null;
        if (firstRow.hsCode) {
          const hs = hsCodeMap.get(firstRow.hsCode.trim());
          if (hs) {
            hsCodeId = hs.id;
          } else {
            for (const row of colorRows) {
              if (!errorRows.some((e) => e._rowIndex === row._rowIndex)) {
                errorRows.push({ ...row, errors: [`Code SH "${firstRow.hsCode}" introuvable. Créez-le d'abord dans Administration > Codes SH.`] });
              }
            }
            processedCount++;
            continue;
          }
        }

        // Couleur principale du produit — doit être l'une des couleurs des variantes.
        // Si vide, on laisse null (le serveur Prisma utilisera resolvePrimaryColorId au
        // prochain enregistrement manuel ; ici l'import laisse explicitement vide).
        let primaryColorId: string | null = null;
        if (firstRow.primaryColor) {
          const wanted = normalizeColorName(firstRow.primaryColor.trim());
          const matchInVariants = resolvedColors.find(
            ({ mainColor }) => normalizeColorName(mainColor.name) === wanted,
          );
          if (matchInVariants) {
            primaryColorId = matchInVariants.mainColor.id;
          } else {
            for (const row of colorRows) {
              if (!errorRows.some((e) => e._rowIndex === row._rowIndex)) {
                errorRows.push({ ...row, errors: [`Couleur principale "${firstRow.primaryColor}" introuvable parmi les variantes du produit.`] });
              }
            }
            processedCount++;
            continue;
          }
        }

        // Détail taille unique : obligatoire dès qu'une variante utilise la taille
        // protégée « Taille unique » (cf. lib/protected-sizes.ts). On regarde tous
        // les noms de tailles parsés pour cette référence.
        const usesProtectedSize = resolvedColors.some(({ row }) => {
          const parsed = parseSizeField(row.size, row.saleType);
          return parsed.some((e) => e.name.trim().toLowerCase() === "taille unique");
        });
        if (usesProtectedSize && !firstRow.sizeDetailsTu?.trim()) {
          for (const row of colorRows) {
            if (!errorRows.some((e) => e._rowIndex === row._rowIndex)) {
              errorRows.push({ ...row, errors: [`Détail taille unique manquant (obligatoire quand une variante utilise « Taille unique »).`] });
            }
          }
          processedCount++;
          continue;
        }

        try {
          const product = await prisma.product.create({
            data: {
              reference: ref,
              name: firstRow.name,
              description: firstRow.description ?? "",
              categoryId: categoryId ?? (await prisma.category.findFirst().then((c) => c?.id ?? "")),
              manufacturingCountryId,
              seasonId,
              hsCodeId,
              primaryColorId,
              sizeDetailsTu: firstRow.sizeDetailsTu?.trim() || null,
              // Tous les imports arrivent en brouillon — la cliente les publie
              // ensuite manuellement depuis la liste des produits.
              // status=OFFLINE + isIncomplete=true → badge « Brouillon » dans l'UI.
              status: "OFFLINE",
              isIncomplete: true,
              isBestSeller: firstRow.isBestSeller ?? false,
              discountPercent: firstRow.discountPercent ?? null,
              dimensionLength: firstRow.dimensionLength ?? null,
              dimensionWidth: firstRow.dimensionWidth ?? null,
              dimensionHeight: firstRow.dimensionHeight ?? null,
              dimensionDiameter: firstRow.dimensionDiameter ?? null,
              dimensionCircumference: firstRow.dimensionCircumference ?? null,
              tags: tagIds.length > 0 ? { create: tagIds.map((id) => ({ tagId: id })) } : undefined,
              compositions: compPairs.length > 0 ? { create: compPairs } : undefined,
              subCategories: subCatIds.length > 0 ? { connect: subCatIds.map((id) => ({ id })) } : undefined,
              colors: {
                // Determine which variant is primary :
                //   1. Si firstRow.primaryColor est défini, on prend la variante dont
                //      le nom de couleur correspond (après normalisation accents/casse)
                //   2. Sinon, par défaut = première variante du groupe
                create: (() => {
                  const primaryColorNorm = firstRow.primaryColor
                    ? normalizeColorName(firstRow.primaryColor)
                    : null;
                  return resolvedColors.map(({ row, mainColor }, ci) => {
                    const isPack = row.saleType === "PACK";
                    const isPrimary = primaryColorNorm
                      ? normalizeColorName(mainColor.name) === primaryColorNorm
                      : ci === 0;
                    return {
                      colorId: mainColor.id,
                      unitPrice: (() => {
                        if (!isPack) return row.unitPrice;
                        const sizeEntries = parseSizeField(row.size, "PACK");
                        const totalQty = sizeEntries.reduce((s, e) => s + e.quantity, 0);
                        return totalQty > 0 ? Math.round(row.unitPrice * totalQty * 100) / 100 : row.unitPrice;
                      })(),
                      weight: row.weight ? row.weight / 1000 : 0.1,
                      stock: row.stock,
                      isPrimary,
                      saleType: row.saleType,
                      packQuantity: isPack
                        ? (() => {
                            const sizeEntries = parseSizeField(row.size, "PACK");
                            const totalQty = sizeEntries.reduce((s, e) => s + e.quantity, 0);
                            return totalQty > 0 ? totalQty : (row.packQuantity ?? null);
                          })()
                        : null,
                    };
                  });
                })(),
              },
            },
            include: { colors: true },
          });

          // Create VariantSize records for variants with a size value
          const productCategoryId = categoryId ?? product.categoryId;
          for (const { row, mainColor } of resolvedColors) {
            if (row.size) {
              const sizeEntries = parseSizeField(row.size, row.saleType);
              if (sizeEntries.length === 0) continue;

              // Find the matching ProductColor
              const pc = product.colors.find((c) => c.colorId === mainColor.id && c.saleType === row.saleType);
              if (!pc) continue;

              for (const entry of sizeEntries) {
                const sizeEntity = await prisma.size.upsert({
                  where: { name: entry.name },
                  create: { name: entry.name },
                  update: {},
                });
                await prisma.variantSize.create({
                  data: {
                    productColorId: pc.id,
                    sizeId: sizeEntity.id,
                    quantity: entry.quantity,
                  },
                });
              }
            }
          }

          // Handle similar products
          if (similarRefsList.length > 0) {
            for (const simRef of similarRefsList) {
              const simProduct = await prisma.product.findUnique({
                where: { reference: simRef },
                select: { id: true },
              });
              if (simProduct) {
                // Create bidirectional link
                await prisma.productSimilar.createMany({
                  data: [
                    { productId: product.id, similarId: simProduct.id },
                    { productId: simProduct.id, similarId: product.id },
                  ],
                  skipDuplicates: true,
                });
              } else {
                // Defer — store in PendingSimilar
                await prisma.pendingSimilar.create({
                  data: { productRef: ref, similarRef: simRef },
                }).catch(() => {}); // ignore duplicates
              }
            }
          }

          // Resolve any pending similar links targeting this product
          const pendingLinks = await prisma.pendingSimilar.findMany({
            where: { similarRef: ref },
          });
          if (pendingLinks.length > 0) {
            for (const link of pendingLinks) {
              const sourceProduct = await prisma.product.findUnique({
                where: { reference: link.productRef },
                select: { id: true },
              });
              if (sourceProduct) {
                await prisma.productSimilar.createMany({
                  data: [
                    { productId: sourceProduct.id, similarId: product.id },
                    { productId: product.id, similarId: sourceProduct.id },
                  ],
                  skipDuplicates: true,
                });
              }
            }
            // Clean up resolved pending links
            await prisma.pendingSimilar.deleteMany({ where: { similarRef: ref } });
          }

          successCount++;

          // Fire-and-forget auto-translation for imported product (via PFS).
          // L'API PFS retourne fr+en en un seul appel — couvre toutes les locales du site.
          autoTranslateProduct(product.id, firstRow.name, firstRow.description ?? "");

          // Emit SSE event for real-time table updates
          emitProductEvent({ type: "PRODUCT_CREATED", productId: product.id });

          // Capture detail for history
          createdProducts.push({
            reference: ref,
            name: firstRow.name,
            category: firstRow.category,
            variants: resolvedColors.map(({ row, mainColor }) => ({
              color: mainColor.name,
              saleType: row.saleType,
              unitPrice: row.unitPrice,
              stock: row.stock,
              packQuantity: row.saleType === "PACK" ? row.packQuantity : undefined,
            })),
          });
        } catch (err) {
          for (const row of colorRows) {
            errorRows.push({ ...row, errors: [`Erreur création: ${err instanceof Error ? err.message : "inconnue"}`] });
          }
        }

        processedCount++;
      }

      // Update progress after each batch
      await prisma.importJob.update({
        where: { id: jobId },
        data: {
          processedItems: processedCount,
          successItems: successCount,
          errorItems: errorRows.length,
          resultDetails: {
            type: "PRODUCTS",
            errorPreview: buildProductErrorPreview(errorRows),
          } as unknown as import("@prisma/client").Prisma.JsonObject,
        },
      });

      // Emit progress event for real-time banner
      emitProductEvent({
        type: "IMPORT_PROGRESS",
        productId: jobId,
        importProgress: {
          jobId,
          processed: processedCount,
          total: totalProducts,
          success: successCount,
          errors: errorRows.length,
          status: "PROCESSING",
        },
      });

      // Breathe — let other requests through
      await new Promise((resolve) => setTimeout(resolve, 50));
    }

    // Create draft for errors if any
    let errorDraftId: string | undefined;
    if (errorRows.length > 0) {
      const draft = await prisma.importDraft.create({
        data: {
          type: "PRODUCTS",
          filename: job.filename,
          totalRows: rows.length,
          successRows: successCount,
          errorRows: errorRows.length,
          rows: errorRows as unknown as import("@prisma/client").Prisma.JsonArray,
          adminId: job.adminId,
        },
      });
      errorDraftId = draft.id;
    }

    // NOTE: revalidateTag does NOT work in fire-and-forget background jobs.
    // Cache invalidation is handled client-side via revalidateAfterImport()
    // server action called from ImportProductsTab when job completes.

    // Mark completed
    await prisma.importJob.update({
      where: { id: jobId },
      data: {
        status: "COMPLETED",
        processedItems: totalProducts,
        successItems: successCount,
        errorItems: errorRows.length,
        errorDraftId,
        resultDetails: {
          type: "PRODUCTS",
          products: createdProducts,
          errorPreview: buildProductErrorPreview(errorRows),
        } as unknown as import("@prisma/client").Prisma.JsonObject,
      },
    });

    // Emit final progress event
    emitProductEvent({
      type: "IMPORT_PROGRESS",
      productId: jobId,
      importProgress: {
        jobId,
        processed: totalProducts,
        total: totalProducts,
        success: successCount,
        errors: errorRows.length,
        status: "COMPLETED",
      },
    });

  } catch (err) {
    logger.error(`[import-processor] Product job ${jobId} failed`, { error: err });
    await prisma.importJob.update({
      where: { id: jobId },
      data: {
        status: "FAILED",
        errorMessage: err instanceof Error ? err.message : "Erreur inconnue",
      },
    }).catch(() => {});

    emitProductEvent({
      type: "IMPORT_PROGRESS",
      productId: jobId,
      importProgress: {
        jobId,
        processed: 0,
        total: 0,
        success: 0,
        errors: 0,
        status: "FAILED",
      },
    });
  }
}

// ─────────────────────────────────────────────
// IMAGE IMPORT — Background processor
// ─────────────────────────────────────────────

/**
 * Parse image filename in supported formats:
 *   "REFERENCE COULEUR POSITION.ext"              (space-separated, original)
 *   "REFERENCE_COULEUR_POSITION.ext"              (underscore-separated)
 *   "A200_Doré,Rouge,Noir,Gris_1.jpg"            (multi-color with comma)
 *   "A200 Doré,Rouge,Noir,Gris 1.jpg"            (multi-color with comma + spaces)
 *
 * Multi-color names use comma "," as separator in filenames (since "/" is
 * forbidden in filenames). They are matched against the DB color name by
 * splitting and comparing each sub-color individually.
 */
function parseImageFilename(filename: string): { reference: string; color: string; position: number } | null {
  const ext = path.extname(filename);
  const base = filename.slice(0, filename.length - ext.length);

  // Underscore format: REF_COULEURS_POSITION (preferred — colors can contain spaces like "Or Rose")
  // Space format: REF COULEUR POSITION (legacy — only when no underscores)
  let reference: string;
  let color: string;
  let positionStr: string;

  if (base.includes("_")) {
    // Split by underscore: exactly 3 parts (REF, COLOR(S), POSITION)
    const firstUnderscore = base.indexOf("_");
    const lastUnderscore = base.lastIndexOf("_");

    if (firstUnderscore === lastUnderscore) return null; // only 1 underscore = can't split 3 parts

    reference = base.slice(0, firstUnderscore);
    color = base.slice(firstUnderscore + 1, lastUnderscore);
    positionStr = base.slice(lastUnderscore + 1);
  } else {
    // Space-separated fallback (no underscores): REF COLOR POSITION
    const parts = base.split(" ").filter(Boolean);
    if (parts.length < 3) return null;

    reference = parts[0];
    positionStr = parts[parts.length - 1];
    color = parts.slice(1, parts.length - 1).join(" ");
  }

  const position = parseInt(positionStr, 10);
  if (isNaN(position) || position < 1 || position > 10) return null;

  reference = reference.trim().toUpperCase();
  color = color.trim();
  if (!reference || !color) return null;

  return { reference, color, position };
}

/**
 * Compacte une position vers la plus basse position libre dans [0, originalOrder].
 *
 * Si l'utilisatrice importe une image avec position 2 (orderInput = 1, 0-based)
 * et que la position 1 (order = 0) est libre côté BDD et job en cours, on glisse
 * l'image en position 1 — pour toujours remplir les positions les plus basses.
 *
 * Si la position est explicitement choisie par l'utilisatrice via la preview
 * (override), on respecte son choix sans compacter.
 *
 * @param originalOrder  position 0-based parsée depuis le filename (ou override).
 * @param usedOrders     positions 0-based déjà occupées (BDD + job en cours).
 * @param overridden     true si la position a été explicitement choisie en preview.
 * @returns              la position 0-based effective à utiliser.
 */
export function compactImageOrder(
  originalOrder: number,
  usedOrders: ReadonlySet<number>,
  overridden: boolean,
): number {
  if (overridden) return originalOrder;
  for (let candidate = 0; candidate <= originalOrder; candidate++) {
    if (!usedOrders.has(candidate)) return candidate;
  }
  return originalOrder;
}

/**
 * Aperçu d'erreur affiché en temps réel pendant l'import.
 * Volontairement plat et léger pour être sérialisable en JSON et envoyé via
 * polling sans charger le navigateur.
 */
export interface ImportErrorPreviewEntry {
  /** Référence du produit (PRODUCTS) ou nom du fichier image (IMAGES). */
  label: string;
  /** Sous-label : nom (PRODUCTS) ou couleur + position (IMAGES). */
  sublabel?: string;
  /** Messages d'erreur — déjà formatés pour affichage utilisateur. */
  errors: string[];
}

/** Nombre maximum d'erreurs conservées pour l'aperçu en temps réel. */
export const ERROR_PREVIEW_LIMIT = 50;

/**
 * Construit l'aperçu (max ERROR_PREVIEW_LIMIT entrées) à partir des erreurs
 * accumulées dans le processeur. On déduplique par référence pour les produits
 * (multi-rows produisent le même message global).
 */
export function buildProductErrorPreview(
  rows: readonly { reference?: string; name?: string; errors: string[] }[],
): ImportErrorPreviewEntry[] {
  const seen = new Set<string>();
  const out: ImportErrorPreviewEntry[] = [];
  for (const r of rows) {
    const ref = (r.reference ?? "").trim() || "(sans référence)";
    if (seen.has(ref)) continue;
    seen.add(ref);
    out.push({
      label: ref,
      sublabel: r.name?.trim() || undefined,
      errors: r.errors.slice(0, 5),
    });
    if (out.length >= ERROR_PREVIEW_LIMIT) break;
  }
  return out;
}

export function buildImageErrorPreview(
  rows: readonly { filename: string; color?: string; position?: number; errors: string[] }[],
): ImportErrorPreviewEntry[] {
  const out: ImportErrorPreviewEntry[] = [];
  for (const r of rows.slice(-ERROR_PREVIEW_LIMIT)) {
    const sub = [r.color, r.position ? `position ${r.position}` : null].filter(Boolean).join(" · ");
    out.push({
      label: r.filename,
      sublabel: sub || undefined,
      errors: r.errors.slice(0, 5),
    });
  }
  return out;
}

// ─────────────────────────────────────────────
// Conflict resolution types
// ─────────────────────────────────────────────

export type ConflictStrategy = "replace" | "next_available" | "shift" | "skip";

export interface ConflictResolution {
  filename: string;
  strategy: ConflictStrategy;
  chosenPosition?: number; // 1-based, only when strategy is a specific position override
}

export interface ConflictResolutions {
  defaultStrategy: ConflictStrategy;
  perFile: ConflictResolution[];
}

/**
 * Glisse vers la première position libre ≥ targetOrder. Utilisé quand l'UI
 * n'a pas de mécanisme de résolution de conflit (ex : correction depuis
 * l'historique) — on évite ainsi toute collision sur la contrainte unique.
 */
export function nextAvailableOrder(targetOrder: number, usedOrders: ReadonlySet<number>): number {
  let candidate = Math.max(0, targetOrder);
  while (usedOrders.has(candidate)) candidate++;
  return candidate;
}

/**
 * Compute the cascade of order updates needed to free a target position by shifting
 * every image at `targetOrder` and above to the next free slot (chain shift).
 *
 * Example: usedOrders = {0, 1, 3}, targetOrder = 0
 *   → image at 0 must move to 2 (the first free slot ≥ 1)
 *   → image at 1 must move to 4 (the first free slot ≥ 2 after 0→2)
 *   → 3 stays in place (no contiguous block at 3+1)
 *
 * Returns an ordered list of moves (from highest source down to lowest) so the
 * caller can apply them sequentially without violating the (productColorId, order)
 * unique constraint.
 */
export function planShiftCascade(
  targetOrder: number,
  usedOrders: ReadonlySet<number>,
): { from: number; to: number }[] {
  if (!usedOrders.has(targetOrder)) return [];
  // Find the contiguous block of occupied orders starting at targetOrder.
  const block: number[] = [];
  let cursor = targetOrder;
  while (usedOrders.has(cursor)) {
    block.push(cursor);
    cursor++;
  }
  // The first free slot just after the block becomes the destination of the highest image.
  // Each image at block[i] is shifted to block[i] + 1; the last one lands on `cursor`.
  // Apply in reverse order so we never collide with an existing row.
  const moves: { from: number; to: number }[] = [];
  for (let i = block.length - 1; i >= 0; i--) {
    moves.push({ from: block[i], to: block[i] + 1 });
  }
  return moves;
}

const IMAGE_BATCH_SIZE = 20;

export async function processImageImport(jobId: string): Promise<void> {
  try {
    const job = await prisma.importJob.findUnique({ where: { id: jobId } });
    if (!job || !job.tempDir) throw new Error("Job introuvable ou tempDir manquant.");

    await prisma.importJob.update({ where: { id: jobId }, data: { status: "PROCESSING" } });

    // Resolve relative tempDir to absolute (tempDir stored as relative in DB)
    const tempDirFull = path.resolve(process.cwd(), job.tempDir);
    const allFiles = await readdir(tempDirFull);
    const allowedExts = [".jpg", ".jpeg", ".png", ".webp", ".gif"];
    const imageFiles = allFiles.filter((f) => allowedExts.includes(path.extname(f).toLowerCase()));

    // Load conflict resolutions if present
    let resolutions: ConflictResolutions = { defaultStrategy: "replace", perFile: [] };
    try {
      const resPath = path.join(tempDirFull, "_resolutions.json");
      const resData = await readFile(resPath, "utf-8");
      resolutions = JSON.parse(resData);
    } catch {
      // No resolutions file — default to "replace"
    }
    const perFileMap = new Map(resolutions.perFile.map((r) => [r.filename, r]));

    // Load file overrides (position/color changes from preview editing)
    let fileOverrides: Record<string, { position?: number; color?: string }> = {};
    try {
      const ovPath = path.join(tempDirFull, "_overrides.json");
      const ovData = await readFile(ovPath, "utf-8");
      fileOverrides = JSON.parse(ovData);
    } catch {
      // No overrides file
    }

    await prisma.importJob.update({
      where: { id: jobId },
      data: { totalItems: imageFiles.length },
    });

    // Parse all filenames
    const validFiles: ImageFileInfo[] = [];
    const errorRows: ImageDraftRow[] = [];

    for (const filename of imageFiles) {
      const parsed = parseImageFilename(filename);
      if (!parsed) {
        errorRows.push({
          filename,
          reference: "",
          color: "",
          position: 0,
          tempPath: "", // will be set when copying to public error dir
          errors: ['Nom de fichier invalide. Format attendu : "REFERENCE COULEUR POSITION.ext" (multi-couleur : "REF Doré,Rouge,Noir 1.jpg")'],
        });
        continue;
      }
      const ov = fileOverrides[filename];
      validFiles.push({
        filename,
        reference: parsed.reference,
        color: ov?.color ?? parsed.color,
        position: ov?.position ?? parsed.position,
        positionOverridden: ov?.position != null,
        filePath: path.join(tempDirFull, filename),
      });
    }

    // Expose parse errors immediately so the UI can show them during processing
    if (errorRows.length > 0) {
      await prisma.importJob.update({
        where: { id: jobId },
        data: {
          errorItems: errorRows.length,
          resultDetails: {
            type: "IMAGES",
            errorPreview: buildImageErrorPreview(errorRows),
          } as unknown as import("@prisma/client").Prisma.JsonObject,
        },
      });
    }

    // Pre-load products for all references in files
    const fileRefs = [...new Set(validFiles.map((f) => f.reference))];
    const products = await prisma.product.findMany({
      where: { reference: { in: fileRefs } },
      include: { colors: { include: { color: true } } },
    });
    const productMap = new Map(products.map((p) => [p.reference.toUpperCase(), p]));

    // Load ALL product references from DB for error suggestions
    const allDbProducts = await prisma.product.findMany({
      select: { reference: true },
      orderBy: { reference: "asc" },
      take: 500,
    });
    const allDbRefs = allDbProducts.map((p) => p.reference);

    let successCount = 0;
    let processedCount = 0;

    // Tracks positions (0-based) already assigned during this job, per productColor.
    // Used to compact positions toward the lowest free slot while preventing two
    // incoming images from landing on the same slot.
    const assignedOrdersByVariant = new Map<string, Set<number>>();

    // Collect detailed results for history display
    const importedImages: {
      filename: string;
      reference: string;
      color: string;
      position: number;
      imagePath: string;
      productId: string;
    }[] = [];

    // Process in batches
    for (let i = 0; i < validFiles.length; i += IMAGE_BATCH_SIZE) {
      const batch = validFiles.slice(i, i + IMAGE_BATCH_SIZE);

      for (const file of batch) {
        const product = productMap.get(file.reference);

        if (!product) {
          errorRows.push({
            filename: file.filename,
            reference: file.reference,
            color: file.color,
            position: file.position,
            tempPath: "", // will be set when copying to public error dir
            errors: [`Référence "${file.reference}" introuvable.`],
            // Provide actual DB product references so frontend can propose alternatives
            availableRefs: allDbRefs,
          });
          processedCount++;
          continue;
        }

        // Match color — file ne contient qu'une couleur par variante
        const fileColor = normalizeColorName(file.color.trim());
        const matchingVariants = product.colors.filter(
          (pc) => pc.color && normalizeColorName(pc.color.name) === fileColor
        );

        if (matchingVariants.length === 0) {
          const availableColors = product.colors.map((pc) => ({
            id: pc.id,
            name: pc.color?.name ?? "",
            hex: pc.color?.hex ?? "#9CA3AF",
            patternImage: pc.color?.patternImage ?? null,
            saleType: pc.saleType,
          }));

          errorRows.push({
            filename: file.filename,
            reference: file.reference,
            color: file.color,
            position: file.position,
            tempPath: "", // will be set when copying to public error dir
            errors: [`Couleur "${file.color}" introuvable sur "${file.reference}".`],
            productId: product.id,
            availableColors,
          });
          processedCount++;
          continue;
        }

        const matchedVariant = matchingVariants[0];
        const originalOrder = file.position - 1;

        // Build the set of positions already taken on this variant: BDD images
        // plus images already routed earlier in this same job.
        const dbOrders = await prisma.productColorImage.findMany({
          where: { productColorId: matchedVariant.id },
          select: { order: true },
        });
        const takenOrders = new Set<number>(dbOrders.map((u) => u.order));
        const assignedHere = assignedOrdersByVariant.get(matchedVariant.id);
        if (assignedHere) for (const o of assignedHere) takenOrders.add(o);

        // Compact toward the lowest free slot (unless the user explicitly chose
        // a position in the preview UI).
        let order = compactImageOrder(originalOrder, takenOrders, file.positionOverridden);

        // Check for existing image at this position
        const existingAtPos = await prisma.productColorImage.findFirst({
          where: { productColorId: matchedVariant.id, order },
        });

        if (existingAtPos) {
          // Determine conflict resolution strategy
          const perFileRes = perFileMap.get(file.filename);
          const strategy = perFileRes?.strategy ?? resolutions.defaultStrategy;

          if (strategy === "skip") {
            processedCount++;
            continue;
          } else if (strategy === "next_available" || (perFileRes?.chosenPosition != null)) {
            if (perFileRes?.chosenPosition != null) {
              // Specific position chosen by user
              order = perFileRes.chosenPosition - 1;
              // Check if chosen position is also occupied
              const chosenOccupied = await prisma.productColorImage.findFirst({
                where: { productColorId: matchedVariant.id, order },
              });
              if (chosenOccupied) {
                // Fall back to next available
                const usedOrders = await prisma.productColorImage.findMany({
                  where: { productColorId: matchedVariant.id },
                  select: { order: true },
                });
                const used = new Set(usedOrders.map((u) => u.order));
                let nextOrder = 0;
                while (used.has(nextOrder)) nextOrder++;
                order = nextOrder;
              }
            } else {
              // Find next available position
              const usedOrders = await prisma.productColorImage.findMany({
                where: { productColorId: matchedVariant.id },
                select: { order: true },
              });
              const used = new Set(usedOrders.map((u) => u.order));
              let nextOrder = 0;
              while (used.has(nextOrder)) nextOrder++;
              order = nextOrder;
            }
          } else if (strategy === "shift") {
            // Cascade shift : déplace l'existante (et les suivantes contiguës)
            // d'une position vers le haut pour libérer `order`.
            const usedRows = await prisma.productColorImage.findMany({
              where: { productColorId: matchedVariant.id },
              select: { id: true, order: true },
            });
            const usedSet = new Set(usedRows.map((r) => r.order));
            const moves = planShiftCascade(order, usedSet);
            // Apply moves from highest source to lowest (already ordered that way)
            // to never violate the (productColorId, order) unique constraint.
            for (const move of moves) {
              const row = usedRows.find((r) => r.order === move.from);
              if (!row) continue;
              await prisma.productColorImage.update({
                where: { id: row.id },
                data: { order: move.to },
              });
            }
            // `order` is now free — proceed to create at the requested slot.
          } else {
            // strategy === "replace" — delete existing image at this position
            await prisma.productColorImage.delete({ where: { id: existingAtPos.id } });
          }
        }

        // Nouveau rangement : public/uploads/produits/{ref}/{ref}-{couleur}-{n}-{stamp}.webp
        const productDir = productImageDir(file.reference);
        const stamp = Date.now().toString(36);
        const safeFilename = `${productImageBaseName(file.reference, file.color, file.position)}-${stamp}`;
        const imageBuffer = await readFile(file.filePath);
        const result = await processProductImage(imageBuffer, productDir, safeFilename);

        // Clean up temp file
        const { unlink } = await import("fs/promises");
        await unlink(file.filePath).catch(() => {});

        const imagePath = result.dbPath;

        await prisma.productColorImage.create({
          data: {
            productId: product.id,
            colorId: matchedVariant.colorId ?? "",
            productColorId: matchedVariant.id,
            path: imagePath,
            order,
          },
        });

        // Reserve this position so subsequent images in the same job don't
        // compact onto it.
        const existingAssigned = assignedOrdersByVariant.get(matchedVariant.id);
        if (existingAssigned) {
          existingAssigned.add(order);
        } else {
          assignedOrdersByVariant.set(matchedVariant.id, new Set([order]));
        }

        successCount++;
        processedCount++;

        // Capture detail for history
        importedImages.push({
          filename: file.filename,
          reference: file.reference,
          color: file.color,
          position: order + 1,
          imagePath,
          productId: product.id,
        });
      }

      // Update progress
      await prisma.importJob.update({
        where: { id: jobId },
        data: {
          processedItems: processedCount + errorRows.length,
          successItems: successCount,
          errorItems: errorRows.length,
          resultDetails: {
            type: "IMAGES",
            errorPreview: buildImageErrorPreview(errorRows),
          } as unknown as import("@prisma/client").Prisma.JsonObject,
        },
      });

      // Breathe
      await new Promise((resolve) => setTimeout(resolve, 50));
    }

    // Also count parse errors in processed
    processedCount += errorRows.length - (errorRows.length - validFiles.filter(() => true).length);

    // Create draft for errors
    let errorDraftId: string | undefined;
    if (errorRows.length > 0) {
      // Move error images to a permanent temp dir (not the upload temp)
      const errorTempDirName = `import_errors_${Date.now()}`;
      const errorTempDirPublic = `uploads/temp/${errorTempDirName}`;
      const errorTempDirFull = path.join(process.cwd(), "public", errorTempDirPublic);
      await mkdir(errorTempDirFull, { recursive: true });

      // Copy error images from private temp dir to public error dir for previews
      const { copyFile } = await import("fs/promises");
      for (const row of errorRows) {
        const srcFull = path.join(tempDirFull, row.filename);
        const destFull = path.join(errorTempDirFull, row.filename);
        try {
          await copyFile(srcFull, destFull);
          row.tempPath = `${errorTempDirPublic}/${row.filename}`;
        } catch {
          // File may have been moved already (successfully processed then failed later)
          row.tempPath = "";
        }
      }

      const draft = await prisma.importDraft.create({
        data: {
          type: "IMAGES",
          filename: `${imageFiles.length} image(s)`,
          totalRows: imageFiles.length,
          successRows: successCount,
          errorRows: errorRows.length,
          rows: errorRows as unknown as import("@prisma/client").Prisma.JsonArray,
          tempDir: errorTempDirPublic,
          adminId: job.adminId,
        },
      });
      errorDraftId = draft.id;
    }

    await prisma.importJob.update({
      where: { id: jobId },
      data: {
        status: "COMPLETED",
        processedItems: imageFiles.length,
        successItems: successCount,
        errorItems: errorRows.length,
        errorDraftId,
        resultDetails: {
          type: "IMAGES",
          images: importedImages,
          errorPreview: buildImageErrorPreview(errorRows),
        } as unknown as import("@prisma/client").Prisma.JsonObject,
      },
    });

  } catch (err) {
    logger.error(`[import-processor] Image job ${jobId} failed`, { error: err });
    await prisma.importJob.update({
      where: { id: jobId },
      data: {
        status: "FAILED",
        errorMessage: err instanceof Error ? err.message : "Erreur inconnue",
      },
    }).catch(() => {});
  }
}
