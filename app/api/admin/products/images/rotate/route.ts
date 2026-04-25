import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import sharp from "sharp";
import { readFile, uploadFile, keyFromDbPath } from "@/lib/storage";
import { getImagePaths } from "@/lib/image-utils";
import { logger } from "@/lib/logger";

/**
 * POST /api/admin/products/images/rotate
 * Rotate a product image by 90° clockwise.
 * Body: { imagePath: "/uploads/products/xxx.webp" }
 * Returns: { success: true, cacheBuster: number }
 */
export async function POST(request: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session || session.user.role !== "ADMIN") {
    return NextResponse.json({ error: "Accès non autorisé." }, { status: 401 });
  }

  const { imagePath } = await request.json();

  if (!imagePath || typeof imagePath !== "string") {
    return NextResponse.json({ error: "Chemin image manquant." }, { status: 400 });
  }

  // Validate path to prevent directory traversal
  const normalized = imagePath.replace(/\\/g, "/");
  if (!normalized.startsWith("/uploads/products/") || normalized.includes("..")) {
    return NextResponse.json({ error: "Chemin invalide." }, { status: 400 });
  }

  const paths = getImagePaths(normalized);
  const variants = [paths.large, paths.medium, paths.thumb];

  try {
    for (const dbPath of variants) {
      const key = keyFromDbPath(dbPath);
      try {
        const buffer = await readFile(key);
        const rotated = await sharp(buffer)
          .rotate(90)
          .webp({ lossless: true, quality: 100, effort: 4 })
          .toBuffer();
        await uploadFile(key, rotated);
      } catch {
        // Variant file might not exist (e.g. missing thumb), skip
      }
    }

    const cacheBuster = Date.now();
    return NextResponse.json({ success: true, cacheBuster }, { status: 200 });
  } catch (err) {
    logger.error("[products/images/rotate] Error", { error: err instanceof Error ? err.message : String(err) });
    return NextResponse.json({ error: "Erreur lors de la rotation." }, { status: 500 });
  }
}
