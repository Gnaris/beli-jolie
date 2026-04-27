import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import * as XLSX from "xlsx";
import { logger } from "@/lib/logger";
import { emitProductEvent } from "@/lib/product-events";
import { parseSizeField } from "@/lib/import-processor";

// ─────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────

export interface ProductImportRow {
  _rowIndex: number;
  reference: string;
  name: string;
  description?: string;
  category?: string;
  color: string;
  saleType: "UNIT" | "PACK";
  unitPrice: number;
  packQuantity?: number;
  stock: number;
  weight?: number; // kg
  isPrimary?: boolean;
  discountPercent?: number;
  size?: string;
  tags?: string;       // comma-separated
  composition?: string; // "Acier:85,Or:15"
}

export interface DraftProductRow extends ProductImportRow {
  errors: string[];
}

export interface ImportResult {
  success: number;
  errors: number;
  draftId?: string;
}

// ─────────────────────────────────────────────
// Parsers
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

  const saleTypeRaw = str(raw["sale_type"] ?? raw["saleType"] ?? raw["type_vente"] ?? "UNIT").toUpperCase();

  return {
    _rowIndex: index + 2, // 1-based + header row
    reference: str(raw["reference"] ?? raw["ref"] ?? raw["référence"]),
    name: str(raw["name"] ?? raw["nom"] ?? raw["name_fr"]),
    description: str(raw["description"] ?? raw["description_fr"]) || undefined,
    category: str(raw["category"] ?? raw["categorie"] ?? raw["catégorie"]) || undefined,
    color: str(raw["color"] ?? raw["couleur"]),
    saleType: saleTypeRaw === "PACK" ? "PACK" : "UNIT",
    unitPrice: num(raw["unit_price"] ?? raw["prix"] ?? raw["price"]) ?? 0,
    packQuantity: int(raw["pack_qty"] ?? raw["pack_quantity"] ?? raw["quantite_pack"]),
    stock: int(raw["stock"] ?? raw["quantite"] ?? raw["qty"]) ?? 0,
    weight: num(raw["weight_g"] ?? raw["poids_g"] ?? raw["poids"]) ?? undefined,
    isPrimary: String(raw["is_primary"] ?? raw["primaire"] ?? "").toLowerCase() === "true" || String(raw["is_primary"] ?? "1") === "1",
    discountPercent: num(raw["discount_percent"] ?? raw["remise_percent"] ?? raw["discount_value"] ?? raw["remise_valeur"]),
    size: str(raw["size"] ?? raw["taille"] ?? raw["Taille"]) || undefined,
    tags: str(raw["tags"]) || undefined,
    composition: str(raw["composition"]) || undefined,
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
        discountPercent: colorVariant.discountPercent ?? undefined,
        size: colorVariant.size ?? undefined,
        tags: Array.isArray(item.tags) ? item.tags.join(",") : (item.tags ?? undefined),
        composition: Array.isArray(item.compositions)
          ? item.compositions.map((c: { material: string; percentage: number }) => `${c.material}:${c.percentage}`).join(",")
          : (item.composition ?? undefined),
      });
      idx++;
    }
  }
  return rows;
}

function parseExcel(buffer: ArrayBuffer): ProductImportRow[] {
  const wb = XLSX.read(buffer, { type: "array" });
  const ws = wb.Sheets[wb.SheetNames[0]];
  const data = XLSX.utils.sheet_to_json<Record<string, unknown>>(ws, { defval: "" });
  return data.map((row, i) => normalizeRow(row, i));
}

// ─────────────────────────────────────────────
// Validation
// ─────────────────────────────────────────────

/** Validate variant-level fields only (per-row) */
function validateVariantRow(row: ProductImportRow): string[] {
  const errors: string[] = [];
  if (!row.color) errors.push("Couleur manquante.");
  if (!["UNIT", "PACK"].includes(row.saleType)) errors.push("Type de vente invalide (UNIT ou PACK).");
  if (!row.size) errors.push("Taille obligatoire.");
  if (!row.unitPrice || row.unitPrice <= 0) errors.push("Prix unitaire invalide.");
  if (row.stock == null || row.stock < 0) errors.push("Stock invalide.");
  if (row.saleType === "PACK" && row.size) {
    const parsed = parseSizeField(row.size, "PACK");
    if (parsed.length === 0) errors.push("Format de taille invalide pour PACK (ex: S:2,M:3,L:1).");
  }
  return errors;
}

// ─────────────────────────────────────────────
// Import logic
// ─────────────────────────────────────────────

/**
 * Validate rows and resolve DB references (colors, categories, etc.)
 * Returns the grouped products ready for creation + any error rows.
 */
async function prepareImport(rows: ProductImportRow[]) {
  const errorRows: DraftProductRow[] = [];

  // 1. Group rows by reference FIRST (before validation)
  const preGrouped = new Map<string, ProductImportRow[]>();
  for (const row of rows) {
    if (!row.reference) {
      errorRows.push({ ...row, errors: ["Référence manquante."] });
      continue;
    }
    const ref = row.reference.toUpperCase();
    if (!preGrouped.has(ref)) preGrouped.set(ref, []);
    preGrouped.get(ref)!.push(row);
  }

  // 2. Inherit product-level fields from the group's primary/first row
  const productFields = ["name", "description", "category", "tags", "composition"] as const;
  for (const [, groupRows] of preGrouped) {
    for (const field of productFields) {
      const source = groupRows.find((r) => r[field]);
      if (!source) continue;
      for (const row of groupRows) {
        if (!row[field] && source[field]) {
          (row as unknown as Record<string, unknown>)[field] = source[field];
        }
      }
    }
  }

  // 3. Validate: product-level (name required per group) + variant-level per row
  const grouped = new Map<string, ProductImportRow[]>();
  for (const [ref, groupRows] of preGrouped) {
    if (!groupRows[0].name) {
      for (const row of groupRows) {
        errorRows.push({ ...row, errors: ["Nom manquant (aucune ligne de cette référence n'a de nom)."] });
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

  // Collect all valid rows for DB lookups
  const validRows = [...grouped.values()].flat();

  // Pre-load colors and categories from DB
  const colorNames = [...new Set(validRows.map((r) => r.color))];
  const categoryNames = [...new Set(validRows.filter((r) => r.category).map((r) => r.category!))];
  const tagNames = [
    ...new Set(
      validRows.flatMap((r) =>
        r.tags
          ? r.tags
              .split(",")
              .map((t) => t.trim())
              .filter(Boolean)
          : []
      )
    ),
  ];
  const compositionMaterials = [
    ...new Set(
      validRows.flatMap((r) =>
        r.composition
          ? r.composition.split(",").map((c) => c.split(":")[0].trim()).filter(Boolean)
          : []
      )
    ),
  ];

  const [dbColors, dbCategories, dbTags, dbCompositions, existingProducts] = await Promise.all([
    prisma.color.findMany({ where: { name: { in: colorNames } } }),
    prisma.category.findMany({ where: { name: { in: categoryNames } } }),
    prisma.tag.findMany({ where: { name: { in: tagNames } } }),
    prisma.composition.findMany({ where: { name: { in: compositionMaterials } } }),
    prisma.product.findMany({ where: { reference: { in: [...grouped.keys()] } }, select: { reference: true } }),
  ]);

  const colorMap = new Map(dbColors.map((c) => [c.name.toLowerCase(), c]));
  const categoryMap = new Map(dbCategories.map((c) => [c.name.toLowerCase(), c]));
  const tagMap = new Map(dbTags.map((t) => [t.name.toLowerCase(), t]));
  const compositionMap = new Map(dbCompositions.map((c) => [c.name.toLowerCase(), c]));
  const existingRefs = new Set(existingProducts.map((p) => p.reference.toUpperCase()));

  // Resolve each product group
  interface ResolvedProduct {
    ref: string;
    firstRow: ProductImportRow;
    resolvedColors: { row: ProductImportRow; color: (typeof dbColors)[0] }[];
    categoryId: string | undefined;
    tagIds: string[];
    compPairs: { compositionId: string; percentage: number }[];
  }

  const readyProducts: ResolvedProduct[] = [];

  for (const [ref, colorRows] of grouped.entries()) {
    // Check color exists in DB
    const resolvedColors: { row: ProductImportRow; color: (typeof dbColors)[0] }[] = [];
    for (const row of colorRows) {
      const dbColor = colorMap.get(row.color.toLowerCase());
      if (!dbColor) {
        errorRows.push({ ...row, errors: [`Couleur "${row.color}" introuvable en base. Créez-la d'abord dans Administration > Couleurs.`] });
        continue;
      }
      resolvedColors.push({ row, color: dbColor });
    }

    if (resolvedColors.length === 0) continue;

    // Category (optional — use first row's category)
    const firstRow = colorRows[0];
    let categoryId: string | undefined;
    if (firstRow.category) {
      const cat = categoryMap.get(firstRow.category.toLowerCase());
      if (!cat) {
        for (const row of colorRows) {
          if (!errorRows.some((e) => e._rowIndex === row._rowIndex)) {
            errorRows.push({ ...row, errors: [`Catégorie "${firstRow.category}" introuvable.`] });
          }
        }
        continue;
      }
      categoryId = cat.id;
    }

    // Build tag ids
    const rowTagNames = firstRow.tags
      ? firstRow.tags.split(",").map((t) => t.trim()).filter(Boolean)
      : [];
    const tagIds: string[] = [];
    const missingTags: string[] = [];
    for (const tName of rowTagNames) {
      const t = tagMap.get(tName.toLowerCase());
      if (t) tagIds.push(t.id);
      else missingTags.push(tName);
    }
    // Auto-create missing tags
    for (const tName of missingTags) {
      const newTag = await prisma.tag.upsert({
        where: { name: tName },
        update: {},
        create: { name: tName },
      });
      tagIds.push(newTag.id);
    }

    // Build compositions
    const compPairs: { compositionId: string; percentage: number }[] = [];
    if (firstRow.composition) {
      for (const part of firstRow.composition.split(",")) {
        const [material, pct] = part.split(":").map((s) => s.trim());
        const comp = compositionMap.get(material.toLowerCase());
        if (comp) {
          compPairs.push({ compositionId: comp.id, percentage: parseFloat(pct) || 0 });
        }
      }
    }

    // If product exists → skip (don't overwrite)
    if (existingRefs.has(ref)) {
      for (const row of colorRows) {
        errorRows.push({ ...row, errors: [`La référence "${ref}" existe déjà. Utilisez l'édition manuelle.`] });
      }
      continue;
    }

    readyProducts.push({ ref, firstRow, resolvedColors, categoryId, tagIds, compPairs });
  }

  return { readyProducts, errorRows };
}

/**
 * Create products in background, one by one, emitting SSE events.
 * Updates the ImportJob progress as it goes.
 */
async function createProductsInBackground(
  readyProducts: Awaited<ReturnType<typeof prepareImport>>["readyProducts"],
  jobId: string,
) {
  let successCount = 0;
  const errorRows: DraftProductRow[] = [];

  for (const { ref, firstRow, resolvedColors, categoryId, tagIds, compPairs } of readyProducts) {
    try {
      const newProduct = await prisma.product.create({
        data: {
          reference: ref,
          name: firstRow.name,
          description: firstRow.description ?? "",
          categoryId: categoryId ?? (await prisma.category.findFirst().then((c) => c?.id ?? "")),
          status: "OFFLINE",
          isBestSeller: false,
          discountPercent: firstRow.discountPercent ?? null,
          tags: tagIds.length > 0 ? { create: tagIds.map((id) => ({ tagId: id })) } : undefined,
          compositions: compPairs.length > 0 ? { create: compPairs } : undefined,
          colors: {
            create: (() => {
              const firstPrimaryIdx = resolvedColors.findIndex(({ row }) => row.isPrimary);
              const primaryIdx = firstPrimaryIdx === -1 ? 0 : firstPrimaryIdx;
              return resolvedColors.map(({ row, color }, i) => {
                const isPack = row.saleType === "PACK";
                const sizeEntries = isPack ? parseSizeField(row.size, "PACK") : [];
                const totalQty = sizeEntries.reduce((s, e) => s + e.quantity, 0);
                return {
                  colorId: isPack ? null : color.id,
                  unitPrice: isPack && totalQty > 0
                    ? Math.round(row.unitPrice * totalQty * 100) / 100
                    : row.unitPrice,
                  weight: row.weight ? row.weight / 1000 : 0.1, // g → kg
                  stock: row.stock,
                  isPrimary: i === primaryIdx,
                  saleType: row.saleType,
                  packQuantity: isPack
                    ? (totalQty > 0 ? totalQty : (row.packQuantity ?? null))
                    : null,
                };
              });
            })(),
          },
        },
        include: { colors: true },
      });

      // Create VariantSize records for variants with a size value
      for (const { row, color } of resolvedColors) {
        if (row.size) {
          const sizeEntries = parseSizeField(row.size, row.saleType);
          if (sizeEntries.length === 0) continue;

          const isPack = row.saleType === "PACK";
          const expectedPrice = isPack
            ? Math.round(row.unitPrice * sizeEntries.reduce((s, e) => s + e.quantity, 0) * 100) / 100
            : row.unitPrice;
          const pc = isPack
            ? newProduct.colors.find((c) => c.saleType === "PACK" && c.colorId === null && c.unitPrice.toString() === expectedPrice.toString())
            : newProduct.colors.find((c) => c.colorId === color.id && c.saleType === row.saleType);
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

      successCount++;

      // Emit SSE event so the product table updates in real-time
      emitProductEvent({ type: "PRODUCT_CREATED", productId: newProduct.id });

      // Update job progress
      await prisma.importJob.update({
        where: { id: jobId },
        data: {
          processedItems: { increment: 1 },
          successItems: { increment: 1 },
        },
      }).catch(() => {});
    } catch (err) {
      for (const row of resolvedColors.map((rc) => rc.row)) {
        errorRows.push({ ...row, errors: [`Erreur création: ${err instanceof Error ? err.message : "inconnue"}`] });
      }
      await prisma.importJob.update({
        where: { id: jobId },
        data: {
          processedItems: { increment: 1 },
          errorItems: { increment: 1 },
        },
      }).catch(() => {});
    }
  }

  // Finalize the job
  let draftId: string | undefined;
  if (errorRows.length > 0) {
    const draft = await prisma.importDraft.create({
      data: {
        type: "PRODUCTS",
        filename: "import-background",
        totalRows: readyProducts.length,
        successRows: successCount,
        errorRows: errorRows.length,
        rows: errorRows as unknown as import("@prisma/client").Prisma.JsonArray,
        adminId: (await prisma.importJob.findUnique({ where: { id: jobId }, select: { adminId: true } }))?.adminId ?? "",
      },
    });
    draftId = draft.id;
  }

  await prisma.importJob.update({
    where: { id: jobId },
    data: {
      status: "COMPLETED",
      errorDraftId: draftId ?? null,
    },
  }).catch(() => {});

  logger.info("[import/products] Background import completed", { jobId, success: successCount, errors: errorRows.length });
}

// ─────────────────────────────────────────────
// POST handler
// ─────────────────────────────────────────────

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session || session.user.role !== "ADMIN") {
    return NextResponse.json({ error: "Non autorisé" }, { status: 401 });
  }

  try {
    const MAX_IMPORT_SIZE = 10 * 1024 * 1024; // 10 MB

    const formData = await req.formData();
    const file = formData.get("file") as File | null;
    if (!file) return NextResponse.json({ error: "Aucun fichier fourni." }, { status: 400 });
    if (file.size > MAX_IMPORT_SIZE) {
      return NextResponse.json({ error: "Fichier trop volumineux (max 10 Mo)." }, { status: 400 });
    }

    const filename = file.name.toLowerCase();
    const buffer = await file.arrayBuffer();

    let rows: ProductImportRow[];
    if (filename.endsWith(".json")) {
      const text = new TextDecoder().decode(buffer);
      rows = parseJSON(text);
    } else if (filename.endsWith(".xlsx") || filename.endsWith(".xls")) {
      rows = parseExcel(buffer);
    } else {
      return NextResponse.json({ error: "Format non supporté. Utilisez .json ou .xlsx." }, { status: 400 });
    }

    if (rows.length === 0) {
      return NextResponse.json({ error: "Fichier vide ou format incorrect." }, { status: 400 });
    }

    // Phase 1: Validate & resolve references (fast, synchronous)
    const { readyProducts, errorRows } = await prepareImport(rows);

    // Create draft for validation errors immediately
    let draftId: string | undefined;
    if (errorRows.length > 0) {
      const draft = await prisma.importDraft.create({
        data: {
          type: "PRODUCTS",
          filename: file.name,
          totalRows: rows.length,
          successRows: 0,
          errorRows: errorRows.length,
          rows: errorRows as unknown as import("@prisma/client").Prisma.JsonArray,
          adminId: session.user.id,
        },
      });
      draftId = draft.id;
    }

    if (readyProducts.length === 0) {
      // Nothing to create — all rows had errors
      return NextResponse.json({
        success: 0,
        errors: errorRows.length,
        total: rows.length,
        draftId,
      });
    }

    // Phase 2: Create an ImportJob and start background creation
    const job = await prisma.importJob.create({
      data: {
        type: "PRODUCTS",
        status: "PROCESSING",
        totalItems: readyProducts.length,
        processedItems: 0,
        successItems: 0,
        errorItems: 0,
        filePath: file.name,
        adminId: session.user.id,
        errorDraftId: draftId ?? null,
      },
    });

    // Fire-and-forget: create products in background
    createProductsInBackground(readyProducts, job.id).catch((err) => {
      logger.error("[import/products] Background import failed", { jobId: job.id, error: err instanceof Error ? err.message : String(err) });
      prisma.importJob.update({ where: { id: job.id }, data: { status: "FAILED", errorMessage: err instanceof Error ? err.message : "Unknown error" } }).catch(() => {});
    });

    // Return immediately — products will be created in background
    return NextResponse.json({
      success: 0, // Will increase as background processing runs
      errors: errorRows.length,
      total: rows.length,
      draftId,
      jobId: job.id,
      productsToCreate: readyProducts.length,
      background: true,
    });
  } catch (err) {
    logger.error("[import/products]", { error: err instanceof Error ? err.message : String(err) });
    return NextResponse.json({ error: err instanceof Error ? err.message : "Erreur serveur." }, { status: 500 });
  }
}
