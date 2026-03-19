import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { normalizeColorName } from "@/lib/import-processor";
import { processProductImage } from "@/lib/image-processor";
import { mkdir } from "fs/promises";
import path from "path";

async function requireAdmin() {
  const session = await getServerSession(authOptions);
  if (!session || session.user.role !== "ADMIN") return null;
  return session;
}

// GET — fetch draft
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await requireAdmin();
  if (!session) return NextResponse.json({ error: "Non autorisé" }, { status: 401 });

  const { id } = await params;
  const draft = await prisma.importDraft.findUnique({ where: { id } });
  if (!draft) return NextResponse.json({ error: "Brouillon introuvable" }, { status: 404 });
  if (draft.adminId !== session.user.id) return NextResponse.json({ error: "Accès refusé" }, { status: 403 });

  return NextResponse.json(draft);
}

// PATCH — update a specific row in the draft (fix an error row and retry)
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await requireAdmin();
  if (!session) return NextResponse.json({ error: "Non autorisé" }, { status: 401 });

  const { id } = await params;
  const draft = await prisma.importDraft.findUnique({ where: { id } });
  if (!draft) return NextResponse.json({ error: "Brouillon introuvable" }, { status: 404 });
  if (draft.adminId !== session.user.id) return NextResponse.json({ error: "Accès refusé" }, { status: 403 });

  const body = await req.json();

  if (draft.type === "PRODUCTS") {
    return handleProductRowFix(draft, body, session.user.id);
  } else {
    return handleImageRowFix(draft, body, session.user.id);
  }
}

// DELETE — delete draft
export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await requireAdmin();
  if (!session) return NextResponse.json({ error: "Non autorisé" }, { status: 401 });

  const { id } = await params;
  const draft = await prisma.importDraft.findUnique({ where: { id } });
  if (!draft) return NextResponse.json({ error: "Brouillon introuvable" }, { status: 404 });
  if (draft.adminId !== session.user.id) return NextResponse.json({ error: "Accès refusé" }, { status: 403 });

  await prisma.importDraft.delete({ where: { id } });
  return NextResponse.json({ ok: true });
}

// ─────────────────────────────────────────────
// Fix product row
// body: { rowIndex: number, updatedRow: ProductImportRow }
// ─────────────────────────────────────────────

async function handleProductRowFix(
  draft: import("@prisma/client").ImportDraft,
  body: { rowIndex: number; updatedRow: Record<string, unknown>; dismiss?: boolean },
  _adminId: string
) {
  const rows = draft.rows as Record<string, unknown>[];

  if (body.dismiss) {
    // Remove row from draft
    const newRows = rows.filter((_, i) => i !== body.rowIndex);
    const updated = await prisma.importDraft.update({
      where: { id: draft.id },
      data: {
        rows: newRows as import("@prisma/client").Prisma.JsonArray,
        errorRows: newRows.length,
        status: newRows.length === 0 ? "RESOLVED" : "PENDING",
      },
    });
    return NextResponse.json({ ok: true, draft: updated });
  }

  const row = body.updatedRow;

  // Re-validate
  const errors: string[] = [];
  if (!row.reference) errors.push("Référence manquante.");
  if (!row.name) errors.push("Nom manquant.");
  if (!row.color) errors.push("Couleur manquante.");
  if (row.unitPrice == null || Number(row.unitPrice) <= 0) errors.push("Prix invalide.");
  if (row.stock == null || Number(row.stock) < 0) errors.push("Stock invalide.");

  if (errors.length > 0) {
    // Update row with new errors
    const newRows = rows.map((r, i) => (i === body.rowIndex ? { ...row, errors } : r));
    await prisma.importDraft.update({
      where: { id: draft.id },
      data: { rows: newRows as import("@prisma/client").Prisma.JsonArray },
    });
    return NextResponse.json({ ok: false, errors });
  }

  // Try to create product
  try {
    // Accent+case insensitive color lookup
    const allColors = await prisma.color.findMany();
    const normalizedSearch = normalizeColorName(String(row.color));
    const color = allColors.find((c) => normalizeColorName(c.name) === normalizedSearch);
    if (!color) {
      const availableColors = allColors.map((c) => ({ id: c.id, name: c.name, hex: c.hex ?? "#9CA3AF" }));
      const newRows = rows.map((r, i) =>
        i === body.rowIndex ? { ...row, errors: [`Couleur "${row.color}" introuvable.`], availableColors } : r
      );
      await prisma.importDraft.update({
        where: { id: draft.id },
        data: { rows: newRows as import("@prisma/client").Prisma.JsonArray },
      });
      return NextResponse.json({ ok: false, errors: [`Couleur "${row.color}" introuvable.`], availableColors });
    }

    let categoryId: string | undefined;
    if (row.category) {
      const cat = await prisma.category.findFirst({ where: { name: { equals: String(row.category) } } });
      if (!cat) {
        const newRows = rows.map((r, i) =>
          i === body.rowIndex ? { ...row, errors: [`Catégorie "${row.category}" introuvable.`] } : r
        );
        await prisma.importDraft.update({
          where: { id: draft.id },
          data: { rows: newRows as import("@prisma/client").Prisma.JsonArray },
        });
        return NextResponse.json({ ok: false, errors: [`Catégorie introuvable.`] });
      }
      categoryId = cat.id;
    } else {
      const firstCat = await prisma.category.findFirst();
      categoryId = firstCat?.id ?? "";
    }

    const existing = await prisma.product.findUnique({ where: { reference: String(row.reference).toUpperCase() } });
    if (existing) {
      return NextResponse.json({ ok: false, errors: [`La référence "${row.reference}" existe déjà.`] });
    }

    await prisma.product.create({
      data: {
        reference: String(row.reference).toUpperCase(),
        name: String(row.name),
        description: String(row.description ?? ""),
        categoryId,
        status: "OFFLINE",
        colors: {
          create: [{
            colorId: color.id,
            unitPrice: Number(row.unitPrice),
            weight: row.weight ? Number(row.weight) / 1000 : 0.1,
            stock: Number(row.stock),
            isPrimary: true,
            saleType: row.saleType === "PACK" ? "PACK" : "UNIT",
            packQuantity: row.saleType === "PACK" ? (Number(row.packQuantity) || null) : null,
            size: row.size ? String(row.size) : null,
            discountType: row.discountType ? String(row.discountType) as "PERCENT" | "AMOUNT" : null,
            discountValue: row.discountValue ? Number(row.discountValue) : null,
          }],
        },
      },
    });

    // Remove fixed row from draft
    const newRows = rows.filter((_, i) => i !== body.rowIndex);
    const updated = await prisma.importDraft.update({
      where: { id: draft.id },
      data: {
        rows: newRows as import("@prisma/client").Prisma.JsonArray,
        errorRows: newRows.length,
        successRows: draft.successRows + 1,
        status: newRows.length === 0 ? "RESOLVED" : "PENDING",
      },
    });

    return NextResponse.json({ ok: true, draft: updated });
  } catch (err) {
    return NextResponse.json({ ok: false, errors: [err instanceof Error ? err.message : "Erreur"] }, { status: 500 });
  }
}

// ─────────────────────────────────────────────
// Fix image row
// body: { rowIndex: number, colorId: string } OR { rowIndex: number, dismiss: true }
// ─────────────────────────────────────────────

async function handleImageRowFix(
  draft: import("@prisma/client").ImportDraft,
  body: {
    rowIndex: number;
    colorId?: string;
    dismiss?: boolean;
    newColorName?: string;
    newColorHex?: string;
    productId?: string;       // override product (reference reassignment)
  },
  _adminId: string
) {
  const rows = draft.rows as Record<string, unknown>[];
  const row = rows[body.rowIndex];
  if (!row) return NextResponse.json({ error: "Ligne introuvable" }, { status: 404 });

  if (body.dismiss) {
    const newRows = rows.filter((_, i) => i !== body.rowIndex);
    const updated = await prisma.importDraft.update({
      where: { id: draft.id },
      data: {
        rows: newRows as import("@prisma/client").Prisma.JsonArray,
        errorRows: newRows.length,
        status: newRows.length === 0 ? "RESOLVED" : "PENDING",
      },
    });
    return NextResponse.json({ ok: true, draft: updated });
  }

  // Use overridden productId if provided (reference reassignment)
  const productId = body.productId || String(row.productId || "");

  // Create new color variant if requested
  let colorId = body.colorId;
  if (!colorId && body.newColorName && body.newColorHex && productId) {
    const color = await prisma.color.upsert({
      where: { name: body.newColorName },
      update: {},
      create: { name: body.newColorName, hex: body.newColorHex },
    });

    await prisma.productColor.create({
      data: {
        productId,
        colorId: color.id,
        unitPrice: 0,
        weight: 0.1,
        stock: 0,
        isPrimary: false,
        saleType: "UNIT",
      },
    });
    colorId = color.id;
  }

  if (!colorId || !productId) {
    return NextResponse.json({ ok: false, errors: ["Couleur ou produit manquant."] }, { status: 400 });
  }

  // Process image through Sharp WebP pipeline
  const tempPath = String(row.tempPath);
  const fullTempPath = path.join(process.cwd(), "public", tempPath);
  const position = Number(row.position) || 1;
  const safeFilename = `prod_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const destDir = path.join(process.cwd(), "public", "uploads", "products");

  try {
    const { readFile } = await import("fs/promises");
    const bytes = await readFile(fullTempPath);
    await mkdir(destDir, { recursive: true });
    const result = await processProductImage(bytes, destDir, safeFilename);

    await prisma.productColorImage.create({
      data: {
        productId,
        colorId,
        path: result.dbPath,
        order: position - 1,
      },
    });

    const newRows = rows.filter((_, i) => i !== body.rowIndex);
    const updated = await prisma.importDraft.update({
      where: { id: draft.id },
      data: {
        rows: newRows as import("@prisma/client").Prisma.JsonArray,
        errorRows: newRows.length,
        successRows: draft.successRows + 1,
        status: newRows.length === 0 ? "RESOLVED" : "PENDING",
      },
    });

    return NextResponse.json({ ok: true, draft: updated });
  } catch (err) {
    return NextResponse.json({ ok: false, errors: [err instanceof Error ? err.message : "Erreur"] }, { status: 500 });
  }
}
