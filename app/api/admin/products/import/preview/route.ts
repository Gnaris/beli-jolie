import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { normalizeColorName } from "@/lib/import-processor";
import * as XLSX from "xlsx";
import { logger } from "@/lib/logger";

// ─────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────

export interface PreviewVariant {
  color: string;
  saleType: "UNIT" | "PACK";
  unitPrice: number;
  stock: number;
  packQuantity?: number;
  size?: string;
  colorFound: boolean;
  errors: string[];
}

export interface PreviewProduct {
  reference: string;
  name: string;
  description?: string;
  category?: string;
  subCategories?: string;
  tags?: string;
  composition?: string;
  variants: PreviewVariant[];
  categoryFound: boolean;
  subCategoriesFound: boolean;
  compositionsFound: boolean;
  referenceExists: boolean;
  totalErrors: number;
  status: "ok" | "warning" | "error";
}

export interface MissingEntity {
  type: "category" | "color" | "subcategory" | "composition";
  name: string;
  usedBy: number; // how many products reference this entity
  parentCategoryName?: string; // for subcategories: name of the category that uses it
}

export interface PreviewResult {
  products: PreviewProduct[];
  totalProducts: number;
  totalVariants: number;
  readyToImport: number;
  withErrors: number;
  alreadyExist: number;
  missingEntities: MissingEntity[];
  totalInFile?: number;
  maxProducts?: number;
}

// ─────────────────────────────────────────────
// Row normalizer (same as import route)
// ─────────────────────────────────────────────

function normalizeRow(raw: Record<string, unknown>, index: number) {
  const str = (v: unknown) => (v != null ? String(v).trim() : "");
  const num = (v: unknown) => { const n = parseFloat(String(v ?? "").replace(",", ".")); return isNaN(n) ? undefined : n; };
  const int = (v: unknown) => { const n = parseInt(String(v ?? "")); return isNaN(n) ? undefined : n; };
  // Support headers with asterisks from template (e.g. "reference *", "name *")
  const saleTypeRaw = str(raw["sale_type"] ?? raw["sale_type *"] ?? raw["saleType"] ?? raw["type_vente"] ?? "UNIT").toUpperCase();
  return {
    _rowIndex: index + 2,
    reference: str(raw["reference"] ?? raw["reference *"] ?? raw["ref"] ?? raw["référence"]),
    name: str(raw["name"] ?? raw["name *"] ?? raw["nom"] ?? raw["name_fr"]),
    description: str(raw["description"] ?? raw["description_fr"]) || undefined,
    category: str(raw["category"] ?? raw["categorie"] ?? raw["catégorie"]) || undefined,
    subCategories: str(raw["sub_categories"] ?? raw["sous_categories"] ?? raw["subCategories"]) || undefined,
    color: str(raw["color"] ?? raw["color *"] ?? raw["couleur"]),
    saleType: saleTypeRaw === "PACK" ? "PACK" as const : "UNIT" as const,
    unitPrice: num(raw["unit_price"] ?? raw["unit_price *"] ?? raw["prix"] ?? raw["price"]) ?? 0,
    packQuantity: int(raw["pack_qty"] ?? raw["pack_quantity"] ?? raw["quantite_pack"]),
    stock: int(raw["stock"] ?? raw["stock *"] ?? raw["quantite"] ?? raw["qty"]) ?? 0,
    tags: str(raw["tags"]) || undefined,
    composition: str(raw["composition"]) || undefined,
    dimensionLength: num(raw["dimension_length"] ?? raw["longueur"]),
    dimensionWidth: num(raw["dimension_width"] ?? raw["largeur"]),
    dimensionHeight: num(raw["dimension_height"] ?? raw["hauteur"]),
    dimensionDiameter: num(raw["dimension_diameter"] ?? raw["diametre"] ?? raw["diamètre"]),
    dimensionCircumference: num(raw["dimension_circumference"] ?? raw["circonference"] ?? raw["circonférence"]),
  };
}

function parseJSON(text: string) {
  const data = JSON.parse(text);
  if (!Array.isArray(data)) throw new Error("Le JSON doit être un tableau.");
  const rows: ReturnType<typeof normalizeRow>[] = [];
  let idx = 0;
  for (const item of data) {
    const colors = Array.isArray(item.colors) ? item.colors : [item];
    for (const c of colors) {
      rows.push({
        _rowIndex: idx + 1,
        reference: String(item.reference ?? "").trim().toUpperCase(),
        name: String(item.name ?? item.name_fr ?? "").trim(),
        description: item.description ?? item.description_fr ?? undefined,
        category: item.category ?? undefined,
        color: String(c.color ?? "").trim(),
        saleType: c.saleType === "PACK" ? "PACK" as const : "UNIT" as const,
        unitPrice: Number(c.unitPrice ?? c.unit_price ?? 0),
        packQuantity: c.packQuantity ?? c.pack_qty ?? undefined,
        stock: Number(c.stock ?? 0),
        tags: Array.isArray(item.tags) ? item.tags.join(",") : (item.tags ?? undefined),
        composition: Array.isArray(item.compositions)
          ? item.compositions.map((comp: { material: string; percentage: number }) => `${comp.material}:${comp.percentage}`).join(",")
          : (item.composition ?? undefined),
        subCategories: Array.isArray(item.subCategories) ? item.subCategories.join(",")
          : Array.isArray(item.sub_categories) ? item.sub_categories.join(",")
          : (item.subCategories ?? item.sub_categories ?? undefined),
        dimensionLength: item.dimensionLength ?? item.dimension_length ?? undefined,
        dimensionWidth: item.dimensionWidth ?? item.dimension_width ?? undefined,
        dimensionHeight: item.dimensionHeight ?? item.dimension_height ?? undefined,
        dimensionDiameter: item.dimensionDiameter ?? item.dimension_diameter ?? undefined,
        dimensionCircumference: item.dimensionCircumference ?? item.dimension_circumference ?? undefined,
      });
      idx++;
    }
  }
  return rows;
}

function parseExcel(buffer: ArrayBuffer) {
  const wb = XLSX.read(buffer, { type: "array" });
  // Use "Produits" sheet if it exists (template has Instructions + Produits), fallback to first sheet
  const ws = wb.Sheets["Produits"] ?? wb.Sheets[wb.SheetNames[0]];
  const data = XLSX.utils.sheet_to_json<Record<string, unknown>>(ws, { defval: "" });

  // Skip the description row (row 2 in template) — detect by checking if "reference" looks like a description
  // Do NOT skip rows with empty reference — they inherit from the previous row
  const filtered = data.filter((row) => {
    const ref = String(row["reference"] ?? row["reference *"] ?? row["ref"] ?? row["référence"] ?? "").trim();
    // Description row has values like "Référence unique du produit" — not a valid product row
    if (ref.toLowerCase().startsWith("référence unique") || ref.toLowerCase().startsWith("reference unique")) return false;
    // Also skip rows where sale_type contains description text instead of UNIT/PACK
    const saleType = String(row["sale_type"] ?? row["sale_type *"] ?? row["saleType"] ?? "").trim().toUpperCase();
    if (saleType && saleType !== "UNIT" && saleType !== "PACK" && saleType.length > 10) return false;
    // Skip completely empty rows (no ref AND no color)
    const color = String(row["color"] ?? row["color *"] ?? row["couleur"] ?? "").trim();
    if (!ref && !color) return false;
    return true;
  });

  return filtered.map((row, i) => normalizeRow(row, i));
}

// ─────────────────────────────────────────────
// POST — preview only, no DB writes
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
    const maxProductsRaw = formData.get("maxProducts") as string | null;
    const maxProducts = maxProductsRaw ? parseInt(maxProductsRaw) : 0;
    if (!file) return NextResponse.json({ error: "Aucun fichier." }, { status: 400 });
    if (file.size > MAX_IMPORT_SIZE) {
      return NextResponse.json({ error: "Fichier trop volumineux (max 10 Mo)." }, { status: 400 });
    }

    const filename = file.name.toLowerCase();
    const buffer = await file.arrayBuffer();

    let rows: ReturnType<typeof normalizeRow>[];
    if (filename.endsWith(".json")) {
      rows = parseJSON(new TextDecoder().decode(buffer));
    } else if (filename.endsWith(".xlsx") || filename.endsWith(".xls")) {
      rows = parseExcel(buffer);
    } else {
      return NextResponse.json({ error: "Format non supporté (.json, .xlsx, .xls)." }, { status: 400 });
    }

    if (rows.length === 0) return NextResponse.json({ error: "Fichier vide." }, { status: 400 });

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

    // Pre-load DB data for validation
    // Split multi-colors "Bleu/Rose/Vert" into individual color names
    const colorNames = [...new Set(
      rows.flatMap((r) => r.color ? r.color.split("/").map((c) => c.trim()).filter(Boolean) : [])
    )];
    const categoryNames = [...new Set(rows.filter((r) => r.category).map((r) => r.category!))];
    const references = [...new Set(rows.map((r) => r.reference).filter(Boolean))];
    const compositionMaterials = [
      ...new Set(
        rows.flatMap((r) =>
          r.composition ? r.composition.split(",").map((c) => c.split(":")[0].trim()).filter(Boolean) : []
        )
      ),
    ];
    const subCatNames = [
      ...new Set(
        rows.flatMap((r) =>
          r.subCategories ? r.subCategories.split(",").map((s) => s.trim()).filter(Boolean) : []
        )
      ),
    ];

    const [dbColors, dbCategories, dbCompositions, dbSubCategories, existingProducts] = await Promise.all([
      prisma.color.findMany({ where: { name: { in: colorNames } }, select: { name: true, id: true } }),
      prisma.category.findMany({ where: { name: { in: categoryNames } }, select: { name: true, id: true } }),
      prisma.composition.findMany({ where: { name: { in: compositionMaterials } }, select: { name: true, id: true } }),
      prisma.subCategory.findMany({ select: { name: true, id: true } }),
      prisma.product.findMany({ where: { reference: { in: references } }, select: { reference: true } }),
    ]);

    const colorSet = new Set(dbColors.map((c) => normalizeColorName(c.name)));
    const categorySet = new Set(dbCategories.map((c) => c.name.toLowerCase()));
    const compositionSet = new Set(dbCompositions.map((c) => c.name.toLowerCase()));
    const subCatSet = new Set(dbSubCategories.map((s) => s.name.toLowerCase()));
    const existingRefSet = new Set(existingProducts.map((p) => p.reference.toUpperCase()));

    // Track missing entities with usage counts
    const missingMap = new Map<string, MissingEntity>();
    const addMissing = (type: MissingEntity["type"], name: string, parentCategoryName?: string) => {
      const key = `${type}:${name.toLowerCase()}`;
      if (missingMap.has(key)) {
        missingMap.get(key)!.usedBy++;
      } else {
        missingMap.set(key, { type, name, usedBy: 1, ...(parentCategoryName ? { parentCategoryName } : {}) });
      }
    };

    // Group rows by reference
    const grouped = new Map<string, ReturnType<typeof normalizeRow>[]>();
    for (const row of rows) {
      if (!row.reference) continue;
      const ref = row.reference.toUpperCase();
      if (!grouped.has(ref)) grouped.set(ref, []);
      grouped.get(ref)!.push(row);
    }

    // Inherit product-level fields from the group: find the first row that has each
    // field and propagate to all rows (field can be on any row, not just the first)
    const productFields = ["name", "description", "category", "tags", "composition", "subCategories", "dimensionLength", "dimensionWidth", "dimensionHeight", "dimensionDiameter", "dimensionCircumference"] as const;
    for (const [, groupRows] of grouped) {
      for (const field of productFields) {
        const source = groupRows.find((r) => r[field as keyof typeof r]);
        if (!source) continue;
        for (const row of groupRows) {
          if (!row[field as keyof typeof row] && source[field as keyof typeof source]) {
            (row as Record<string, unknown>)[field] = source[field as keyof typeof source];
          }
        }
      }
    }

    const products: PreviewProduct[] = [];
    let readyToImport = 0;
    let withErrors = 0;
    let alreadyExist = 0;

    // Apply maxProducts limit — only preview first N products
    let entries = [...grouped.entries()];
    const totalBeforeLimit = entries.length;
    if (maxProducts > 0 && entries.length > maxProducts) {
      entries = entries.slice(0, maxProducts);
    }

    for (const [ref, groupRows] of entries) {
      const firstRow = groupRows[0];
      const referenceExists = existingRefSet.has(ref);

      const categoryFound = !firstRow.category || categorySet.has((firstRow.category ?? "").toLowerCase());
      if (firstRow.category && !categoryFound) addMissing("category", firstRow.category);

      // Validate compositions
      let compositionsFound = true;
      if (firstRow.composition) {
        for (const part of firstRow.composition.split(",")) {
          const material = part.split(":")[0].trim();
          if (material && !compositionSet.has(material.toLowerCase())) {
            compositionsFound = false;
            addMissing("composition", material);
          }
        }
      }

      // Validate sub-categories
      let subCategoriesFound = true;
      if (firstRow.subCategories) {
        for (const scName of firstRow.subCategories.split(",").map((s) => s.trim()).filter(Boolean)) {
          if (!subCatSet.has(scName.toLowerCase())) {
            subCategoriesFound = false;
            addMissing("subcategory", scName, firstRow.category);
          }
        }
      }

      const variants: PreviewVariant[] = groupRows.map((row) => {
        const errors: string[] = [];
        // Multi-color support: "Bleu/Rose/Vert" → check each sub-color
        const subColors = row.color ? row.color.split("/").map((c) => c.trim()).filter(Boolean) : [];
        const missingColors = subColors.filter((c) => !colorSet.has(normalizeColorName(c)));
        const colorFound = subColors.length > 0 && missingColors.length === 0;

        if (!row.color) errors.push("Couleur manquante.");
        else if (missingColors.length > 0) {
          errors.push(`Couleur(s) introuvable(s) : ${missingColors.join(", ")}`);
          for (const mc of missingColors) addMissing("color", mc);
        }
        if (!row.unitPrice || row.unitPrice <= 0) errors.push("Prix invalide.");
        if (row.stock == null || row.stock < 0) errors.push("Stock invalide.");
        if (row.saleType === "PACK" && (!row.packQuantity || row.packQuantity < 1))
          errors.push("Quantité de pack requise.");

        return {
          color: row.color,
          saleType: row.saleType,
          unitPrice: row.unitPrice,
          stock: row.stock,
          packQuantity: row.packQuantity,
          size: undefined,
          colorFound,
          errors,
        };
      });

      const productErrors: string[] = [];
      if (!firstRow.reference) productErrors.push("Référence manquante.");
      if (!firstRow.name) productErrors.push("Nom manquant.");
      if (firstRow.category && !categoryFound) productErrors.push(`Catégorie "${firstRow.category}" introuvable.`);
      if (!compositionsFound) productErrors.push("Composition(s) introuvable(s).");
      if (!subCategoriesFound) productErrors.push("Sous-catégorie(s) introuvable(s).");
      if (referenceExists) productErrors.push(`La référence "${ref}" existe déjà.`);

      const variantErrors = variants.flatMap((v) => v.errors);
      const totalErrors = productErrors.length + variantErrors.length;

      let status: "ok" | "warning" | "error" = "ok";
      if (referenceExists) { status = "error"; alreadyExist++; }
      else if (totalErrors > 0) { status = "warning"; withErrors++; }
      else readyToImport++;

      products.push({
        reference: ref || "(vide)",
        name: firstRow.name,
        description: firstRow.description,
        category: firstRow.category,
        subCategories: firstRow.subCategories,
        tags: firstRow.tags,
        composition: firstRow.composition,
        variants,
        categoryFound,
        subCategoriesFound,
        compositionsFound,
        referenceExists,
        totalErrors,
        status,
      });
    }

    const result: PreviewResult = {
      products,
      totalProducts: products.length,
      totalVariants: entries.reduce((sum, [, rows]) => sum + rows.length, 0),
      readyToImport,
      withErrors,
      alreadyExist,
      missingEntities: [...missingMap.values()],
      totalInFile: totalBeforeLimit,
      maxProducts: maxProducts > 0 ? maxProducts : undefined,
    };

    return NextResponse.json(result);
  } catch (err) {
    logger.error("[import/preview]", { error: err instanceof Error ? err.message : String(err) });
    return NextResponse.json({ error: err instanceof Error ? err.message : "Erreur." }, { status: 500 });
  }
}
