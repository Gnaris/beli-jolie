import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { normalizeColorName, parseSizeField } from "@/lib/import-processor";
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

    const newProduct = await prisma.product.create({
      data: {
        reference: String(row.reference).toUpperCase(),
        name: String(row.name),
        description: String(row.description ?? ""),
        categoryId,
        status: "OFFLINE",
        colors: {
          create: [{
            colorId: color.id,
            unitPrice: (() => {
              const isPack = row.saleType === "PACK";
              const price = Number(row.unitPrice);
              if (!isPack) return price;
              const sizeEntries = parseSizeField(row.size ? String(row.size) : undefined, "PACK");
              const totalQty = sizeEntries.reduce((s, e) => s + e.quantity, 0);
              return totalQty > 0 ? Math.round(price * totalQty * 100) / 100 : price;
            })(),
            weight: row.weight ? Number(row.weight) / 1000 : 0.1,
            stock: Number(row.stock),
            isPrimary: true,
            saleType: row.saleType === "PACK" ? "PACK" : "UNIT",
            packQuantity: row.saleType === "PACK"
              ? (() => {
                  const sizeEntries = parseSizeField(row.size ? String(row.size) : undefined, "PACK");
                  const totalQty = sizeEntries.reduce((s, e) => s + e.quantity, 0);
                  return totalQty > 0 ? totalQty : (Number(row.packQuantity) || null);
                })()
              : null,
          }],
        },
      },
      include: { colors: true },
    });

    // Create VariantSize records (supports multi-size for PACK)
    if (row.size) {
      const saleType = row.saleType === "PACK" ? "PACK" as const : "UNIT" as const;
      const sizeEntries = parseSizeField(String(row.size), saleType);
      const pc = newProduct.colors[0];
      if (pc && sizeEntries.length > 0) {
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
    createVariant?: {         // create new variant with multi-color selection
      colorIds: string[];     // Color model IDs — first = main, rest = sub-colors
      unitPrice?: number;
      stock?: number;
      weight?: number;
      saleType?: "UNIT" | "PACK";
      packQuantity?: number;
      size?: string;
    };
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

  // body.colorId is now actually a productColorId (variant ID) from the availableColors list
  let productColorId = body.colorId;

  // Create new variant with multi-color selection (main + sub-colors)
  if (!productColorId && body.createVariant?.colorIds?.length && productId) {
    const cv = body.createVariant;

    // Validate required fields
    if (!cv.unitPrice || cv.unitPrice <= 0) {
      return NextResponse.json({ ok: false, errors: ["Le prix unitaire est obligatoire et doit être supérieur à 0."] }, { status: 400 });
    }
    if (!cv.weight || cv.weight <= 0) {
      return NextResponse.json({ ok: false, errors: ["Le poids est obligatoire et doit être supérieur à 0."] }, { status: 400 });
    }
    const saleType = cv.saleType === "PACK" ? "PACK" : "UNIT";
    if (saleType === "PACK" && (!cv.packQuantity || cv.packQuantity < 2)) {
      return NextResponse.json({ ok: false, errors: ["La quantité par pack doit être d'au moins 2."] }, { status: 400 });
    }

    const [mainColorId, ...subColorIds] = cv.colorIds;
    const newVariant = await prisma.productColor.create({
      data: {
        productId,
        colorId: mainColorId,
        unitPrice: cv.unitPrice,
        weight: cv.weight,
        stock: cv.stock != null && cv.stock >= 0 ? cv.stock : 0,
        isPrimary: false,
        saleType,
        packQuantity: saleType === "PACK" && cv.packQuantity ? cv.packQuantity : null,
        subColors: subColorIds.length > 0 ? {
          create: subColorIds.map((id, i) => ({
            colorId: id,
            position: i,
          })),
        } : undefined,
      },
    });
    productColorId = newVariant.id;

    // Create VariantSize if size is provided
    if (cv.size?.trim()) {
      const sizeName = cv.size.trim();
      const sizeEntity = await prisma.size.upsert({
        where: { name: sizeName },
        create: { name: sizeName },
        update: {},
      });
      await prisma.variantSize.create({
        data: {
          productColorId: newVariant.id,
          sizeId: sizeEntity.id,
          quantity: 1,
        },
      });
    }
  }

  // Create new color variant if requested (legacy single-color flow)
  if (!productColorId && body.newColorName && body.newColorHex && productId) {
    const color = await prisma.color.upsert({
      where: { name: body.newColorName },
      update: {},
      create: { name: body.newColorName, hex: body.newColorHex },
    });

    const newVariant = await prisma.productColor.create({
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
    productColorId = newVariant.id;
  }

  if (!productColorId || !productId) {
    return NextResponse.json({ ok: false, errors: ["Couleur ou produit manquant."] }, { status: 400 });
  }

  // Verify the variant exists and belongs to this product
  const variant = await prisma.productColor.findFirst({
    where: { id: productColorId, productId },
    select: { id: true, colorId: true },
  });
  if (!variant) {
    return NextResponse.json({ ok: false, errors: ["Variante introuvable sur ce produit."] }, { status: 400 });
  }

  // Process image through Sharp WebP pipeline
  const tempPath = String(row.tempPath);
  const fullTempPath = path.join(process.cwd(), "public", tempPath);
  const position = Number(row.position) || 1;
  const safeFilename = `prod_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const destDir = "public/uploads/products";

  try {
    const { readFile } = await import("fs/promises");
    const bytes = await readFile(fullTempPath);
    const result = await processProductImage(bytes, destDir, safeFilename);

    await prisma.productColorImage.create({
      data: {
        productId,
        colorId: variant.colorId ?? "",
        productColorId: variant.id,
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
