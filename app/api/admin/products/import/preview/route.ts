import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import * as XLSX from "xlsx";

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
  tags?: string;
  composition?: string;
  variants: PreviewVariant[];
  categoryFound: boolean;
  referenceExists: boolean;
  totalErrors: number;
  status: "ok" | "warning" | "error";
}

export interface PreviewResult {
  products: PreviewProduct[];
  totalProducts: number;
  totalVariants: number;
  readyToImport: number;
  withErrors: number;
  alreadyExist: number;
}

// ─────────────────────────────────────────────
// Row normalizer (same as import route)
// ─────────────────────────────────────────────

function normalizeRow(raw: Record<string, unknown>, index: number) {
  const str = (v: unknown) => (v != null ? String(v).trim() : "");
  const num = (v: unknown) => { const n = parseFloat(String(v ?? "").replace(",", ".")); return isNaN(n) ? undefined : n; };
  const int = (v: unknown) => { const n = parseInt(String(v ?? "")); return isNaN(n) ? undefined : n; };
  const saleTypeRaw = str(raw["sale_type"] ?? raw["saleType"] ?? raw["type_vente"] ?? "UNIT").toUpperCase();
  return {
    _rowIndex: index + 2,
    reference: str(raw["reference"] ?? raw["ref"] ?? raw["référence"]),
    name: str(raw["name"] ?? raw["nom"] ?? raw["name_fr"]),
    description: str(raw["description"] ?? raw["description_fr"]) || undefined,
    category: str(raw["category"] ?? raw["categorie"] ?? raw["catégorie"]) || undefined,
    color: str(raw["color"] ?? raw["couleur"]),
    saleType: saleTypeRaw === "PACK" ? "PACK" as const : "UNIT" as const,
    unitPrice: num(raw["unit_price"] ?? raw["prix"] ?? raw["price"]) ?? 0,
    packQuantity: int(raw["pack_qty"] ?? raw["pack_quantity"] ?? raw["quantite_pack"]),
    stock: int(raw["stock"] ?? raw["quantite"] ?? raw["qty"]) ?? 0,
    tags: str(raw["tags"]) || undefined,
    composition: str(raw["composition"]) || undefined,
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
      });
      idx++;
    }
  }
  return rows;
}

function parseExcel(buffer: ArrayBuffer) {
  const wb = XLSX.read(buffer, { type: "array" });
  const ws = wb.Sheets[wb.SheetNames[0]];
  const data = XLSX.utils.sheet_to_json<Record<string, unknown>>(ws, { defval: "" });
  return data.map((row, i) => normalizeRow(row, i));
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

    // Pre-load DB data for validation
    const colorNames = [...new Set(rows.map((r) => r.color).filter(Boolean))];
    const categoryNames = [...new Set(rows.filter((r) => r.category).map((r) => r.category!))];
    const references = [...new Set(rows.map((r) => r.reference).filter(Boolean))];

    const [dbColors, dbCategories, existingProducts] = await Promise.all([
      prisma.color.findMany({ where: { name: { in: colorNames } }, select: { name: true, id: true } }),
      prisma.category.findMany({ where: { name: { in: categoryNames } }, select: { name: true, id: true } }),
      prisma.product.findMany({ where: { reference: { in: references } }, select: { reference: true } }),
    ]);

    const colorSet = new Set(dbColors.map((c) => c.name.toLowerCase()));
    const categorySet = new Set(dbCategories.map((c) => c.name.toLowerCase()));
    const existingRefSet = new Set(existingProducts.map((p) => p.reference.toUpperCase()));

    // Group rows by reference
    const grouped = new Map<string, ReturnType<typeof normalizeRow>[]>();
    for (const row of rows) {
      const ref = row.reference.toUpperCase();
      if (!grouped.has(ref)) grouped.set(ref, []);
      grouped.get(ref)!.push(row);
    }

    const products: PreviewProduct[] = [];
    let readyToImport = 0;
    let withErrors = 0;
    let alreadyExist = 0;

    for (const [ref, groupRows] of grouped.entries()) {
      const firstRow = groupRows[0];
      const referenceExists = existingRefSet.has(ref);

      const categoryFound = !firstRow.category || categorySet.has((firstRow.category ?? "").toLowerCase());

      const variants: PreviewVariant[] = groupRows.map((row) => {
        const colorFound = colorSet.has(row.color.toLowerCase());
        const errors: string[] = [];

        if (!row.color) errors.push("Couleur manquante.");
        else if (!colorFound) errors.push(`Couleur "${row.color}" introuvable.`);
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
        tags: firstRow.tags,
        composition: firstRow.composition,
        variants,
        categoryFound,
        referenceExists,
        totalErrors,
        status,
      });
    }

    const result: PreviewResult = {
      products,
      totalProducts: products.length,
      totalVariants: rows.length,
      readyToImport,
      withErrors,
      alreadyExist,
    };

    return NextResponse.json(result);
  } catch (err) {
    console.error("[import/preview]", err);
    return NextResponse.json({ error: err instanceof Error ? err.message : "Erreur." }, { status: 500 });
  }
}
