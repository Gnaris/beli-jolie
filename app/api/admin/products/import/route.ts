import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import * as XLSX from "xlsx";

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
  discountType?: "PERCENT" | "AMOUNT";
  discountValue?: number;
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
    discountType: (str(raw["discount_type"] ?? raw["remise_type"]).toUpperCase() as "PERCENT" | "AMOUNT") || undefined,
    discountValue: num(raw["discount_value"] ?? raw["remise_valeur"]),
    size: str(raw["size"] ?? raw["taille"]) || undefined,
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
        discountType: colorVariant.discountType ?? undefined,
        discountValue: colorVariant.discountValue ?? undefined,
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

function validateRow(row: ProductImportRow): string[] {
  const errors: string[] = [];
  if (!row.reference) errors.push("Référence manquante.");
  if (!row.name) errors.push("Nom manquant.");
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
// Import logic
// ─────────────────────────────────────────────

async function importRows(rows: ProductImportRow[], adminId: string) {
  const validRows: ProductImportRow[] = [];
  const errorRows: DraftProductRow[] = [];

  // Pre-validate
  for (const row of rows) {
    const errs = validateRow(row);
    if (errs.length > 0) {
      errorRows.push({ ...row, errors: errs });
    } else {
      validRows.push(row);
    }
  }

  // Group valid rows by reference
  const grouped = new Map<string, ProductImportRow[]>();
  for (const row of validRows) {
    const ref = row.reference.toUpperCase();
    if (!grouped.has(ref)) grouped.set(ref, []);
    grouped.get(ref)!.push(row);
  }

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

  let successCount = 0;

  for (const [ref, colorRows] of grouped.entries()) {
    const productErrors: string[] = [];

    // Check color exists in DB
    const resolvedColors: { row: ProductImportRow; color: (typeof dbColors)[0] }[] = [];
    for (const row of colorRows) {
      const dbColor = colorMap.get(row.color.toLowerCase());
      if (!dbColor) {
        errorRows.push({ ...row, errors: [`Couleur "${row.color}" introuvable en base. Créez-la d'abord dans Administration > Couleurs.`] });
        productErrors.push("color_not_found");
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

    try {
      const newProduct = await prisma.product.create({
        data: {
          reference: ref,
          name: firstRow.name,
          description: firstRow.description ?? "",
          categoryId: categoryId ?? (await prisma.category.findFirst().then((c) => c?.id ?? "")),
          status: "OFFLINE",
          isBestSeller: false,
          tags: tagIds.length > 0 ? { create: tagIds.map((id) => ({ tagId: id })) } : undefined,
          compositions: compPairs.length > 0 ? { create: compPairs } : undefined,
          colors: {
            create: resolvedColors.map(({ row, color }, i) => ({
              colorId: color.id,
              unitPrice: row.unitPrice,
              weight: row.weight ? row.weight / 1000 : 0.1, // g → kg
              stock: row.stock,
              isPrimary: row.isPrimary || i === 0,
              saleType: row.saleType,
              packQuantity: row.saleType === "PACK" ? (row.packQuantity ?? null) : null,
              discountType: row.discountType ?? null,
              discountValue: row.discountValue ?? null,
            })),
          },
        },
        include: { colors: true },
      });

      // Create VariantSize records for variants with a size value
      for (const { row, color } of resolvedColors) {
        if (row.size) {
          const sizeName = row.size.trim();
          if (sizeName) {
            const sizeEntity = await prisma.size.upsert({
              where: { name: sizeName },
              create: { name: sizeName },
              update: {},
            });
            const pc = newProduct.colors.find((c) => c.colorId === color.id);
            if (pc) {
              await prisma.variantSize.create({
                data: {
                  productColorId: pc.id,
                  sizeId: sizeEntity.id,
                  quantity: 1,
                },
              });
            }
          }
        }
      }

      successCount++;
    } catch (err) {
      for (const row of colorRows) {
        errorRows.push({ ...row, errors: [`Erreur création: ${err instanceof Error ? err.message : "inconnue"}`] });
      }
    }
  }

  return { successCount, errorRows };
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

    const { successCount, errorRows } = await importRows(rows, session.user.id);

    let draftId: string | undefined;
    if (errorRows.length > 0) {
      const draft = await prisma.importDraft.create({
        data: {
          type: "PRODUCTS",
          filename: file.name,
          totalRows: rows.length,
          successRows: successCount,
          errorRows: errorRows.length,
          rows: errorRows as unknown as import("@prisma/client").Prisma.JsonArray,
          adminId: session.user.id,
        },
      });
      draftId = draft.id;
    }

    return NextResponse.json({
      success: successCount,
      errors: errorRows.length,
      total: rows.length,
      draftId,
    });
  } catch (err) {
    console.error("[import/products]", err);
    return NextResponse.json({ error: err instanceof Error ? err.message : "Erreur serveur." }, { status: 500 });
  }
}
