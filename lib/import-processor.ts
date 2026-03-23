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
import * as XLSX from "xlsx";
import { readFile, readdir, mkdir } from "fs/promises";
import { processProductImage } from "@/lib/image-processor";
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
// Types (mirrored from import route)
// ─────────────────────────────────────────────

interface ProductImportRow {
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
  isPrimary?: boolean;
  discountType?: "PERCENT" | "AMOUNT";
  discountValue?: number;
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
}

interface DraftProductRow extends ProductImportRow {
  errors: string[];
}

interface ImageFileInfo {
  filename: string;
  reference: string;
  color: string;
  position: number;
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
  availableColors?: { id: string; name: string; hex: string; patternImage?: string | null; subColors?: { hex: string; patternImage?: string | null }[] }[];
  availableRefs?: string[];
}

// ─────────────────────────────────────────────
// Product parsing (same logic as import route)
// ─────────────────────────────────────────────

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

  // Support headers with asterisks from template (e.g. "reference *", "name *")
  const saleTypeRaw = str(raw["sale_type"] ?? raw["sale_type *"] ?? raw["saleType"] ?? raw["type_vente"] ?? "UNIT").toUpperCase();

  return {
    _rowIndex: index + 2,
    reference: str(raw["reference"] ?? raw["reference *"] ?? raw["ref"] ?? raw["référence"]),
    name: str(raw["name"] ?? raw["name *"] ?? raw["nom"] ?? raw["name_fr"]),
    description: str(raw["description"] ?? raw["description_fr"]) || undefined,
    category: str(raw["category"] ?? raw["categorie"] ?? raw["catégorie"]) || undefined,
    color: str(raw["color"] ?? raw["color *"] ?? raw["couleur"]),
    saleType: saleTypeRaw === "PACK" ? "PACK" : "UNIT",
    unitPrice: num(raw["unit_price"] ?? raw["unit_price *"] ?? raw["prix"] ?? raw["price"]) ?? 0,
    packQuantity: int(raw["pack_qty"] ?? raw["pack_quantity"] ?? raw["quantite_pack"]),
    stock: int(raw["stock"] ?? raw["stock *"] ?? raw["quantite"] ?? raw["qty"]) ?? 0,
    weight: num(raw["weight_g"] ?? raw["poids_g"] ?? raw["poids"]) ?? undefined,
    isPrimary: String(raw["is_primary"] ?? raw["primaire"] ?? "").toLowerCase() === "true",
    discountType: (str(raw["discount_type"] ?? raw["remise_type"]).toUpperCase() as "PERCENT" | "AMOUNT") || undefined,
    discountValue: num(raw["discount_value"] ?? raw["remise_valeur"]),
    size: str(raw["size"] ?? raw["taille"]) || undefined,
    tags: str(raw["tags"]) || undefined,
    composition: str(raw["composition"]) || undefined,
    subCategories: str(raw["sub_categories"] ?? raw["sous_categories"] ?? raw["subCategories"]) || undefined,
    similarRefs: str(raw["similar_refs"] ?? raw["produits_similaires"] ?? raw["similarRefs"]) || undefined,
    dimensionLength: num(raw["dimension_length"] ?? raw["longueur"]),
    dimensionWidth: num(raw["dimension_width"] ?? raw["largeur"]),
    dimensionHeight: num(raw["dimension_height"] ?? raw["hauteur"]),
    dimensionDiameter: num(raw["dimension_diameter"] ?? raw["diametre"] ?? raw["diamètre"]),
    dimensionCircumference: num(raw["dimension_circumference"] ?? raw["circonference"] ?? raw["circonférence"]),
    manufacturingCountry: str(raw["manufacturing_country"] ?? raw["pays_fabrication"] ?? raw["pays"]) || undefined,
    season: str(raw["season"] ?? raw["saison"] ?? raw["collection"]) || undefined,
  };
}

function parseJSON(text: string): ProductImportRow[] {
  const data = JSON.parse(text);
  if (!Array.isArray(data)) throw new Error("Le JSON doit être un tableau.");
  const rows: ProductImportRow[] = [];
  let idx = 0;
  for (const item of data) {
    const colors = Array.isArray(item.colors) ? item.colors : [item];
    for (const colorVariant of colors) {
      rows.push({
        _rowIndex: idx + 1,
        reference: String(item.reference ?? "").trim(),
        name: String(item.name ?? item.name_fr ?? "").trim(),
        description: item.description ?? item.description_fr ?? undefined,
        category: item.category ?? undefined,
        color: String(colorVariant.color ?? "").trim(),
        saleType: colorVariant.saleType === "PACK" ? "PACK" : "UNIT",
        unitPrice: Number(colorVariant.unitPrice ?? colorVariant.unit_price ?? 0),
        packQuantity: colorVariant.packQuantity ?? colorVariant.pack_qty ?? undefined,
        stock: Number(colorVariant.stock ?? 0),
        weight: colorVariant.weight ?? colorVariant.weight_g ?? undefined,
        isPrimary: colorVariant.isPrimary ?? false,
        discountType: colorVariant.discountType ?? undefined,
        discountValue: colorVariant.discountValue ?? undefined,
        size: colorVariant.size ?? undefined,
        tags: Array.isArray(item.tags) ? item.tags.join(",") : (item.tags ?? undefined),
        composition: Array.isArray(item.compositions)
          ? item.compositions.map((c: { material: string; percentage: number }) => `${c.material}:${c.percentage}`).join(",")
          : (item.composition ?? undefined),
        subCategories: Array.isArray(item.subCategories) ? item.subCategories.join(",")
          : Array.isArray(item.sub_categories) ? item.sub_categories.join(",")
          : (item.subCategories ?? item.sub_categories ?? undefined),
        similarRefs: Array.isArray(item.similarRefs) ? item.similarRefs.join(",")
          : Array.isArray(item.similar_refs) ? item.similar_refs.join(",")
          : (item.similarRefs ?? item.similar_refs ?? undefined),
        dimensionLength: item.dimensionLength ?? item.dimension_length ?? undefined,
        dimensionWidth: item.dimensionWidth ?? item.dimension_width ?? undefined,
        dimensionHeight: item.dimensionHeight ?? item.dimension_height ?? undefined,
        dimensionDiameter: item.dimensionDiameter ?? item.dimension_diameter ?? undefined,
        dimensionCircumference: item.dimensionCircumference ?? item.dimension_circumference ?? undefined,
        manufacturingCountry: item.manufacturingCountry ?? item.manufacturing_country ?? item.pays_fabrication ?? undefined,
        season: item.season ?? item.saison ?? item.collection ?? undefined,
      });
      idx++;
    }
  }
  return rows;
}

function parseExcel(buffer: Buffer): ProductImportRow[] {
  const wb = XLSX.read(buffer, { type: "buffer" });
  // Use "Produits" sheet if it exists (template has Instructions + Produits), fallback to first sheet
  const ws = wb.Sheets["Produits"] ?? wb.Sheets[wb.SheetNames[0]];
  const data = XLSX.utils.sheet_to_json<Record<string, unknown>>(ws, { defval: "" });

  // Skip the description row (row 2 in template) — detect by checking if "reference" looks like a description
  // Do NOT skip rows with empty reference — they inherit from the previous row
  const filtered = data.filter((row) => {
    const ref = String(row["reference"] ?? row["reference *"] ?? row["ref"] ?? row["référence"] ?? "").trim();
    if (ref.toLowerCase().startsWith("référence unique") || ref.toLowerCase().startsWith("reference unique")) return false;
    const saleType = String(row["sale_type"] ?? row["sale_type *"] ?? row["saleType"] ?? "").trim().toUpperCase();
    if (saleType && saleType !== "UNIT" && saleType !== "PACK" && saleType.length > 10) return false;
    // Skip completely empty rows (no ref AND no color)
    const color = String(row["color"] ?? row["color *"] ?? row["couleur"] ?? "").trim();
    if (!ref && !color) return false;
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
  if (row.saleType === "PACK" && (!row.packQuantity || row.packQuantity < 1))
    errors.push("Quantité de pack requise pour le type PACK.");
  if (!row.unitPrice || row.unitPrice <= 0) errors.push("Prix unitaire invalide.");
  if (row.stock == null || row.stock < 0) errors.push("Stock invalide.");
  if (row.discountType && !["PERCENT", "AMOUNT"].includes(row.discountType))
    errors.push("Type de remise invalide (PERCENT ou AMOUNT).");
  return errors;
}

// ─────────────────────────────────────────────
// PRODUCT IMPORT — Background processor
// ─────────────────────────────────────────────

const PRODUCT_BATCH_SIZE = 50; // products (not rows) per batch

export async function processProductImport(jobId: string): Promise<void> {
  try {
    const job = await prisma.importJob.findUnique({ where: { id: jobId } });
    if (!job || !job.filePath) throw new Error("Job introuvable.");

    // Mark as processing
    await prisma.importJob.update({ where: { id: jobId }, data: { status: "PROCESSING" } });

    // Read & parse file (filePath stored as relative in DB)
    const buffer = await readFile(path.resolve(process.cwd(), job.filePath));
    const filename = job.filename?.toLowerCase() ?? "";
    let rows: ProductImportRow[];

    if (filename.endsWith(".json")) {
      rows = parseJSON(buffer.toString("utf-8"));
    } else {
      rows = parseExcel(buffer);
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
    const productFields = ["name", "description", "category", "tags", "composition", "subCategories", "similarRefs", "manufacturingCountry", "season", "dimensionLength", "dimensionWidth", "dimensionHeight", "dimensionDiameter", "dimensionCircumference"] as const;
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

    const grouped = new Map<string, ProductImportRow[]>();
    const errorRows: DraftProductRow[] = [];

    // Now validate each row (variant-level only — name is inherited from first row)
    for (const [ref, groupRows] of preGrouped) {
      // Check product-level: at least the first row must have a name
      if (!groupRows[0].name) {
        for (const row of groupRows) {
          errorRows.push({ ...row, errors: ["Nom manquant (première ligne de la référence)."] });
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

    const totalProducts = grouped.size;
    await prisma.importJob.update({
      where: { id: jobId },
      data: { totalItems: totalProducts, errorItems: errorRows.length },
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

    const [dbColors, dbCategories, dbTags, dbCompositions, dbSubCategories, dbCountries, dbSeasons, existingProducts] = await Promise.all([
      prisma.color.findMany({ where: { name: { in: colorNames } } }),
      prisma.category.findMany({ where: { name: { in: categoryNames } } }),
      prisma.tag.findMany({ where: { name: { in: tagNames } } }),
      prisma.composition.findMany({ where: { name: { in: compositionMaterials } } }),
      prisma.subCategory.findMany(),
      prisma.manufacturingCountry.findMany({ where: { name: { in: countryNames } } }),
      prisma.season.findMany({ where: { name: { in: seasonNames } } }),
      prisma.product.findMany({ where: { reference: { in: [...grouped.keys()] } }, select: { reference: true } }),
    ]);

    const colorMap = new Map(dbColors.map((c) => [normalizeColorName(c.name), c]));
    const categoryMap = new Map(dbCategories.map((c) => [c.name.toLowerCase(), c]));
    const tagMap = new Map(dbTags.map((t) => [t.name.toLowerCase(), t]));
    const compositionMap = new Map(dbCompositions.map((c) => [c.name.toLowerCase(), c]));
    const subCatMap = new Map(dbSubCategories.map((s) => [s.name.toLowerCase(), s]));
    const countryMap = new Map(dbCountries.map((c) => [c.name.toLowerCase(), c]));
    const seasonMap = new Map(dbSeasons.map((s) => [s.name.toLowerCase(), s]));
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

        // Resolve colors — supports multi-color "Bleu/Rose/Vert"
        // First color = main colorId, remaining = sub-colors (ProductColorSubColor)
        const resolvedColors: {
          row: ProductImportRow;
          mainColor: (typeof dbColors)[0];
          subColors: (typeof dbColors)[0][];
        }[] = [];
        for (const row of colorRows) {
          const parts = row.color.split("/").map((c) => c.trim()).filter(Boolean);
          if (parts.length === 0) {
            errorRows.push({ ...row, errors: [`Couleur manquante.`] });
            continue;
          }
          const missingParts: string[] = [];
          const resolvedParts: (typeof dbColors)[0][] = [];
          for (const part of parts) {
            const dbColor = colorMap.get(normalizeColorName(part));
            if (!dbColor) {
              missingParts.push(part);
            } else {
              resolvedParts.push(dbColor);
            }
          }
          if (missingParts.length > 0) {
            errorRows.push({ ...row, errors: [`Couleur(s) introuvable(s) : ${missingParts.join(", ")}`] });
            continue;
          }
          resolvedColors.push({
            row,
            mainColor: resolvedParts[0],
            subColors: resolvedParts.slice(1),
          });
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
        console.log(`[import] Ref=${ref} subCategories="${firstRow.subCategories}" (dbSubCategories count=${dbSubCategories.length})`);
        if (firstRow.subCategories) {
          for (const scName of firstRow.subCategories.split(",").map((s) => s.trim()).filter(Boolean)) {
            const scLower = scName.toLowerCase();
            // Prefer match in the same category
            const sc = dbSubCategories.find(
              (s) => s.name.toLowerCase() === scLower && (categoryId ? s.categoryId === categoryId : true)
            ) ?? dbSubCategories.find((s) => s.name.toLowerCase() === scLower);
            if (sc) {
              console.log(`[import] ✓ SubCat "${scName}" → id=${sc.id}`);
              subCatIds.push(sc.id);
            } else {
              console.log(`[import] ✗ SubCat "${scName}" NOT FOUND. DB names: ${dbSubCategories.map((s) => s.name).join(", ")}`);

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

        // Manufacturing country — warn if not found
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

        // Season — warn if not found
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

        try {
          console.log(`[import] Creating product ${ref}: subCatIds=[${subCatIds.join(",")}], compPairs=${compPairs.length}, tagIds=${tagIds.length}`);
          const product = await prisma.product.create({
            data: {
              reference: ref,
              name: firstRow.name,
              description: firstRow.description ?? "",
              categoryId: categoryId ?? (await prisma.category.findFirst().then((c) => c?.id ?? "")),
              manufacturingCountryId,
              seasonId,
              status: "OFFLINE",
              isBestSeller: false,
              dimensionLength: firstRow.dimensionLength ?? null,
              dimensionWidth: firstRow.dimensionWidth ?? null,
              dimensionHeight: firstRow.dimensionHeight ?? null,
              dimensionDiameter: firstRow.dimensionDiameter ?? null,
              dimensionCircumference: firstRow.dimensionCircumference ?? null,
              tags: tagIds.length > 0 ? { create: tagIds.map((id) => ({ tagId: id })) } : undefined,
              compositions: compPairs.length > 0 ? { create: compPairs } : undefined,
              subCategories: subCatIds.length > 0 ? { connect: subCatIds.map((id) => ({ id })) } : undefined,
              colors: {
                // Determine which variant is primary: use explicit is_primary from Excel,
                // or default to the first variant if none is explicitly marked
                create: (() => {
                  const hasExplicitPrimary = resolvedColors.some(({ row }) => row.isPrimary);
                  return resolvedColors.map(({ row, mainColor, subColors }, ci) => ({
                  colorId: mainColor.id,
                  unitPrice: row.unitPrice,
                  weight: row.weight ? row.weight / 1000 : 0.1,
                  stock: row.stock,
                  isPrimary: hasExplicitPrimary ? (row.isPrimary === true) : ci === 0,
                  saleType: row.saleType,
                  packQuantity: row.saleType === "PACK" ? (row.packQuantity ?? null) : null,
                  size: row.size ?? null,
                  discountType: row.discountType ?? null,
                  discountValue: row.discountValue ?? null,
                  // Create sub-colors if multi-color (e.g. "Bleu/Rose/Vert")
                  subColors: subColors.length > 0
                    ? { create: subColors.map((sc, idx) => ({ colorId: sc.id, position: idx })) }
                    : undefined,
                }));
                })(),
              },
            },
          });

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

          // Capture detail for history
          createdProducts.push({
            reference: ref,
            name: firstRow.name,
            category: firstRow.category,
            variants: resolvedColors.map(({ row, mainColor, subColors }) => ({
              color: subColors.length > 0
                ? [mainColor.name, ...subColors.map((sc) => sc.name)].join("/")
                : mainColor.name,
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

    // Mark completed
    await prisma.importJob.update({
      where: { id: jobId },
      data: {
        status: "COMPLETED",
        processedItems: totalProducts,
        successItems: successCount,
        errorItems: errorRows.length,
        errorDraftId,
        resultDetails: { type: "PRODUCTS", products: createdProducts } as unknown as import("@prisma/client").Prisma.JsonObject,
      },
    });

    console.log(`[import-processor] Product job ${jobId} completed: ${successCount} success, ${errorRows.length} errors`);
  } catch (err) {
    console.error(`[import-processor] Product job ${jobId} failed:`, err);
    await prisma.importJob.update({
      where: { id: jobId },
      data: {
        status: "FAILED",
        errorMessage: err instanceof Error ? err.message : "Erreur inconnue",
      },
    }).catch(() => {});
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

// ─────────────────────────────────────────────
// Conflict resolution types
// ─────────────────────────────────────────────

export type ConflictStrategy = "replace" | "next_available" | "skip";

export interface ConflictResolution {
  filename: string;
  strategy: ConflictStrategy;
  chosenPosition?: number; // 1-based, only when strategy is a specific position override
}

export interface ConflictResolutions {
  defaultStrategy: ConflictStrategy;
  perFile: ConflictResolution[];
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
        filePath: path.join(tempDirFull, filename),
      });
    }

    // Pre-load products for all references in files
    const fileRefs = [...new Set(validFiles.map((f) => f.reference))];
    const products = await prisma.product.findMany({
      where: { reference: { in: fileRefs } },
      include: { colors: { include: { color: true, subColors: { include: { color: true } } } } },
    });
    const productMap = new Map(products.map((p) => [p.reference.toUpperCase(), p]));

    // Load ALL product references from DB for error suggestions
    const allDbProducts = await prisma.product.findMany({
      select: { reference: true },
      orderBy: { reference: "asc" },
      take: 500,
    });
    const allDbRefs = allDbProducts.map((p) => p.reference);

    // Destination dir — relative to project root (processProductImage adds process.cwd())
    const productDir = "public/uploads/products";

    let successCount = 0;
    let processedCount = 0;

    // Collect detailed results for history display
    const importedImages: {
      filename: string;
      reference: string;
      color: string;
      position: number;
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

        // Match color — compare the ordered list of colors (main + sub-colors)
        // File: "Doré,Argenté,Or Rose" → main=Doré, sub=[Argenté, Or Rose] in order
        // Comma separator in filenames (since "/" is forbidden)
        const fileColorParts = file.color.split(",").map((c) => normalizeColorName(c.trim()));

        // Build the ordered color list for each variant (main color + sub-colors by position)
        let matchingVariants = product.colors.filter((pc) => {
          const variantColors = [
            normalizeColorName(pc.color.name),
            ...pc.subColors.map((sc) => normalizeColorName(sc.color.name)),
          ];
          // Exact ordered match (order matters: Doré,Rouge ≠ Rouge,Doré)
          return variantColors.length === fileColorParts.length &&
            variantColors.every((c, i) => c === fileColorParts[i]);
        });

        // Fallback: if no exact ordered match, try matching by main color only (single-color files)
        if (matchingVariants.length === 0 && fileColorParts.length === 1) {
          matchingVariants = product.colors.filter(
            (pc) => normalizeColorName(pc.color.name) === fileColorParts[0]
          );
        }

        if (matchingVariants.length === 0) {
          // List all variant combinations (main + sub-colors) for error correction UI
          const availableColors = product.colors.map((pc) => {
            const subNames = pc.subColors
              .sort((a, b) => a.position - b.position)
              .map((sc) => sc.color.name);
            const fullName = subNames.length > 0
              ? [pc.color.name, ...subNames].join("/")
              : pc.color.name;
            return {
              id: pc.id,              // ProductColor ID (variant), not Color ID
              name: fullName,
              hex: pc.color.hex ?? "#9CA3AF",
              patternImage: pc.color.patternImage ?? null,
              subColors: pc.subColors
                .sort((a, b) => a.position - b.position)
                .map((sc) => ({
                  hex: sc.color.hex ?? "#9CA3AF",
                  patternImage: sc.color.patternImage ?? null,
                })),
              saleType: pc.saleType,
            };
          });

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
        let order = file.position - 1;

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
          } else {
            // strategy === "replace" — delete existing image at this position
            await prisma.productColorImage.delete({ where: { id: existingAtPos.id } });
          }
        }

        // Process image through Sharp WebP pipeline
        const safeFilename = `prod_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
        const imageBuffer = await readFile(file.filePath);
        const result = await processProductImage(imageBuffer, productDir, safeFilename);

        // Clean up temp file
        const { unlink } = await import("fs/promises");
        await unlink(file.filePath).catch(() => {});

        const imagePath = result.dbPath;

        await prisma.productColorImage.create({
          data: {
            productId: product.id,
            colorId: matchedVariant.colorId,
            productColorId: matchedVariant.id,
            path: imagePath,
            order,
          },
        });

        successCount++;
        processedCount++;

        // Capture detail for history
        importedImages.push({
          filename: file.filename,
          reference: file.reference,
          color: file.color,
          position: order + 1,
        });
      }

      // Update progress
      await prisma.importJob.update({
        where: { id: jobId },
        data: {
          processedItems: processedCount + errorRows.length,
          successItems: successCount,
          errorItems: errorRows.length,
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
        resultDetails: { type: "IMAGES", images: importedImages } as unknown as import("@prisma/client").Prisma.JsonObject,
      },
    });

    console.log(`[import-processor] Image job ${jobId} completed: ${successCount} success, ${errorRows.length} errors`);
  } catch (err) {
    console.error(`[import-processor] Image job ${jobId} failed:`, err);
    await prisma.importJob.update({
      where: { id: jobId },
      data: {
        status: "FAILED",
        errorMessage: err instanceof Error ? err.message : "Erreur inconnue",
      },
    }).catch(() => {});
  }
}
