import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import sharp from "sharp";
import { readFile, writeFile } from "fs/promises";
import path from "path";

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

  const baseName = path.basename(normalized, path.extname(normalized));
  const dir = path.join(process.cwd(), "public", path.dirname(normalized));

  const variants = [
    { suffix: "", file: `${baseName}.webp` },
    { suffix: "_md", file: `${baseName}_md.webp` },
    { suffix: "_thumb", file: `${baseName}_thumb.webp` },
  ];

  try {
    for (const v of variants) {
      const filePath = path.join(dir, v.file);
      try {
        const buffer = await readFile(filePath);
        const rotated = await sharp(buffer)
          .rotate(90)
          .webp({ quality: v.suffix === "" ? 90 : v.suffix === "_md" ? 82 : 80 })
          .toBuffer();
        await writeFile(filePath, rotated);
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
