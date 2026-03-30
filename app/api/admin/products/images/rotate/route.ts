import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import sharp from "sharp";
import { downloadFromR2, uploadToR2, r2KeyFromDbPath } from "@/lib/r2";
import { getImagePaths } from "@/lib/image-utils";

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
  const variants = [
    { dbPath: paths.large, quality: 100 },
    { dbPath: paths.medium, quality: 100 },
    { dbPath: paths.thumb, quality: 100 },
  ];

  try {
    for (const v of variants) {
      const key = r2KeyFromDbPath(v.dbPath);
      try {
        const buffer = await downloadFromR2(key);
        const rotated = await sharp(buffer)
          .rotate(90)
          .webp({ quality: v.quality })
          .toBuffer();
        await uploadToR2(key, rotated);
      } catch {
        // Variant file might not exist (e.g. missing thumb), skip
      }
    }

    const cacheBuster = Date.now();
    return NextResponse.json({ success: true, cacheBuster }, { status: 200 });
  } catch (err) {
    console.error("[products/images/rotate] Error:", err);
    return NextResponse.json({ error: "Erreur lors de la rotation." }, { status: 500 });
  }
}
