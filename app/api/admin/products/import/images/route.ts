import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { mkdir, writeFile } from "fs/promises";
import path from "path";
import { existsSync } from "fs";
import { processProductImage } from "@/lib/image-processor";
import { normalizeColorName } from "@/lib/import-processor";

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

/**
 * Parse image filename in supported formats:
 *   "REFERENCE COULEUR POSITION.ext"         (space-separated)
 *   "REFERENCE_COULEUR_POSITION.ext"         (underscore-separated)
 *   "A200_Doré,Rouge,Noir_1.jpg"             (multi-color with comma)
 *   "A200 Doré,Rouge,Noir 1.jpg"             (multi-color with comma + spaces)
 */
function parseImageFilename(filename: string): { reference: string; color: string; position: number } | null {
  const ext = path.extname(filename);
  const base = filename.slice(0, filename.length - ext.length);

  let reference: string;
  let color: string;
  let positionStr: string;

  if (base.includes("_")) {
    // Underscore format: REF_COULEURS_POSITION (colors can contain spaces like "Or Rose")
    const firstUnderscore = base.indexOf("_");
    const lastUnderscore = base.lastIndexOf("_");
    if (firstUnderscore === lastUnderscore) return null;

    reference = base.slice(0, firstUnderscore);
    color = base.slice(firstUnderscore + 1, lastUnderscore);
    positionStr = base.slice(lastUnderscore + 1);
  } else {
    // Space-separated fallback
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
            include: { color: true, subColors: { include: { color: true } } },
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

      // Match color — compare full set of colors (main + sub-colors)
      const fileColorParts = color.split(",").map((c) => normalizeColorName(c.trim())).sort();

      let matchingVariants = product.colors.filter((pc) => {
        const variantColors = [
          normalizeColorName(pc.color.name),
          ...pc.subColors.map((sc) => normalizeColorName(sc.color.name)),
        ].sort();
        return variantColors.length === fileColorParts.length &&
          variantColors.every((c, i) => c === fileColorParts[i]);
      });

      // Fallback: single-color file → match by main color only
      if (matchingVariants.length === 0 && fileColorParts.length === 1) {
        matchingVariants = product.colors.filter(
          (pc) => normalizeColorName(pc.color.name) === fileColorParts[0]
        );
      }

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
      const matchedVariant = matchingVariants[0];
      const colorId = matchedVariant.colorId;
      const productDir = "public/uploads/products";

      const safeFilename = `prod_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
      const bytes = await file.arrayBuffer();
      const result = await processProductImage(Buffer.from(bytes), productDir, safeFilename);

      const imagePath = result.dbPath;

      // Position is 1-based, order is 0-based index
      const order = position - 1;

      await prisma.productColorImage.create({
        data: {
          productId: product.id,
          colorId,
          productColorId: matchedVariant.id,
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
