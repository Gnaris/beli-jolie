import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { writeFile, mkdir } from "fs/promises";
import path from "path";
import { existsSync } from "fs";

// ─────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────

export interface ImageImportRow {
  filename: string;
  reference: string;
  color: string;
  position: number;
  tempPath: string; // path relative to public/
  errors: string[];
  productId?: string;
  colorId?: string;
  availableColors?: { id: string; name: string; hex: string }[];
}

// ─────────────────────────────────────────────
// Parse filename: "REFERENCE COLOR POSITION.ext"
// e.g. "REF001 Doré 2.jpg" → { reference: "REF001", color: "Doré", position: 2 }
// Reference = first token (no spaces), Color = middle tokens, Position = last token (number)
// ─────────────────────────────────────────────

function parseImageFilename(filename: string): { reference: string; color: string; position: number } | null {
  const ext = path.extname(filename);
  const base = filename.slice(0, filename.length - ext.length);
  const parts = base.split(" ").filter(Boolean);

  if (parts.length < 3) return null;

  const positionStr = parts[parts.length - 1];
  const position = parseInt(positionStr, 10);
  if (isNaN(position) || position < 1 || position > 10) return null;

  const reference = parts[0].toUpperCase();
  const color = parts.slice(1, parts.length - 1).join(" ");

  if (!reference || !color) return null;

  return { reference, color, position };
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
    const MAX_IMAGE_SIZE = 5 * 1024 * 1024; // 5 MB per image

    const formData = await req.formData();
    const files = formData.getAll("images") as File[];

    if (files.length === 0) {
      return NextResponse.json({ error: "Aucune image fournie." }, { status: 400 });
    }

    const oversized = files.filter((f) => f.size > MAX_IMAGE_SIZE);
    if (oversized.length > 0) {
      return NextResponse.json({
        error: `${oversized.length} image(s) dépassent la taille maximale de 5 Mo.`,
      }, { status: 400 });
    }

    const allowedExts = [".jpg", ".jpeg", ".png", ".webp", ".gif"];

    // Temp dir for error images
    const tempDirName = `import_${Date.now()}`;
    const tempDirPublic = `uploads/temp/${tempDirName}`;
    const tempDirFull = path.join(process.cwd(), "public", tempDirPublic);
    await mkdir(tempDirFull, { recursive: true });

    const results: ImageImportRow[] = [];
    const successRows: ImageImportRow[] = [];
    const errorRows: ImageImportRow[] = [];

    for (const file of files) {
      const ext = path.extname(file.name).toLowerCase();
      if (!allowedExts.includes(ext)) {
        errorRows.push({
          filename: file.name,
          reference: "",
          color: "",
          position: 0,
          tempPath: "",
          errors: [`Extension "${ext}" non supportée.`],
        });
        continue;
      }

      const parsed = parseImageFilename(file.name);
      if (!parsed) {
        // Save to temp for draft
        const tempPath = `${tempDirPublic}/${file.name}`;
        const fullPath = path.join(process.cwd(), "public", tempPath);
        const bytes = await file.arrayBuffer();
        await writeFile(fullPath, Buffer.from(bytes));

        errorRows.push({
          filename: file.name,
          reference: "",
          color: "",
          position: 0,
          tempPath,
          errors: ['Nom de fichier invalide. Format attendu : "REFERENCE COULEUR POSITION.ext" (ex: REF001 Doré 1.jpg)'],
        });
        continue;
      }

      const { reference, color, position } = parsed;

      // Find product by reference
      const product = await prisma.product.findUnique({
        where: { reference },
        include: {
          colors: {
            include: { color: true },
          },
        },
      });

      if (!product) {
        const tempPath = `${tempDirPublic}/${file.name}`;
        const fullPath = path.join(process.cwd(), "public", tempPath);
        const bytes = await file.arrayBuffer();
        await writeFile(fullPath, Buffer.from(bytes));

        errorRows.push({
          filename: file.name,
          reference,
          color,
          position,
          tempPath,
          errors: [`Référence "${reference}" introuvable.`],
        });
        continue;
      }

      // Find matching color variant
      const matchingVariants = product.colors.filter(
        (pc) => pc.color.name.toLowerCase() === color.toLowerCase()
      );

      if (matchingVariants.length === 0) {
        const tempPath = `${tempDirPublic}/${file.name}`;
        const fullPath = path.join(process.cwd(), "public", tempPath);
        const bytes = await file.arrayBuffer();
        await writeFile(fullPath, Buffer.from(bytes));

        const availableColors = [
          ...new Map(product.colors.map((pc) => [pc.colorId, pc.color])).values(),
        ].map((c) => ({ id: c.id, name: c.name, hex: c.hex ?? "#9CA3AF" }));

        errorRows.push({
          filename: file.name,
          reference,
          color,
          position,
          tempPath,
          errors: [`Couleur "${color}" introuvable sur le produit "${reference}".`],
          productId: product.id,
          availableColors,
        });
        continue;
      }

      // Valid — save image to product folder
      const colorId = matchingVariants[0].colorId;
      const productDir = path.join(process.cwd(), "public", "uploads", "products");
      await mkdir(productDir, { recursive: true });

      const safeFilename = `${Date.now()}_${position}${ext}`;
      const destPath = path.join(productDir, safeFilename);
      const bytes = await file.arrayBuffer();
      await writeFile(destPath, Buffer.from(bytes));

      const imagePath = `/uploads/products/${safeFilename}`;

      // Check if position already exists — compute order
      const existingImages = await prisma.productColorImage.findMany({
        where: { productId: product.id, colorId },
        orderBy: { order: "asc" },
      });

      // Position is 1-based, order is 0-based index
      const order = position - 1;

      await prisma.productColorImage.create({
        data: {
          productId: product.id,
          colorId,
          path: imagePath,
          order,
        },
      });

      successRows.push({
        filename: file.name,
        reference,
        color,
        position,
        tempPath: imagePath,
        errors: [],
        productId: product.id,
        colorId,
      });
    }

    let draftId: string | undefined;
    if (errorRows.length > 0) {
      const draft = await prisma.importDraft.create({
        data: {
          type: "IMAGES",
          filename: `${files.length} image(s)`,
          totalRows: files.length,
          successRows: successRows.length,
          errorRows: errorRows.length,
          rows: errorRows as unknown as import("@prisma/client").Prisma.JsonArray,
          tempDir: tempDirPublic,
          adminId: session.user.id,
        },
      });
      draftId = draft.id;
    }

    return NextResponse.json({
      success: successRows.length,
      errors: errorRows.length,
      total: files.length,
      draftId,
    });
  } catch (err) {
    console.error("[import/images]", err);
    return NextResponse.json({ error: err instanceof Error ? err.message : "Erreur serveur." }, { status: 500 });
  }
}
