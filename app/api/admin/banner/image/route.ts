import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import sharp from "sharp";
import { writeFile, mkdir } from "fs/promises";
import path from "path";

/**
 * POST /api/admin/banner/image
 * Upload de l'image de la bannière d'accueil → conversion WebP, format large (1920px).
 */
export async function POST(request: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session || session.user.role !== "ADMIN") {
    return NextResponse.json({ error: "Accès non autorisé." }, { status: 401 });
  }

  const formData = await request.formData();
  const file = formData.get("image") as File | null;

  if (!file || file.size === 0) {
    return NextResponse.json({ error: "Aucun fichier reçu." }, { status: 400 });
  }

  const allowedTypes = ["image/jpeg", "image/png", "image/webp"];
  if (!allowedTypes.includes(file.type)) {
    return NextResponse.json(
      { error: "Format non supporté. Accepté : JPG, PNG, WEBP." },
      { status: 400 }
    );
  }

  if (file.size > 10 * 1024 * 1024) {
    return NextResponse.json(
      { error: "Fichier trop lourd (max 10 Mo)." },
      { status: 400 }
    );
  }

  try {
    const buffer = Buffer.from(await file.arrayBuffer());
    const destDir = path.join(process.cwd(), "public/uploads/banner");
    await mkdir(destDir, { recursive: true });

    const filename = `banner-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

    // Banner: wide format, 1920px max width, auto height
    const oriented = sharp(buffer).rotate();

    const [largeBuffer, mediumBuffer] = await Promise.all([
      oriented
        .clone()
        .resize(1920, 800, { fit: "inside", withoutEnlargement: true })
        .webp({ quality: 90 })
        .toBuffer(),
      oriented
        .clone()
        .resize(960, 400, { fit: "inside", withoutEnlargement: true })
        .webp({ quality: 82 })
        .toBuffer(),
    ]);

    await Promise.all([
      writeFile(path.join(destDir, `${filename}.webp`), largeBuffer),
      writeFile(path.join(destDir, `${filename}_md.webp`), mediumBuffer),
    ]);

    const dbPath = `/uploads/banner/${filename}.webp`;

    return NextResponse.json({ path: dbPath });
  } catch (err) {
    console.error("[banner/image] Processing error:", err);
    return NextResponse.json({ error: "Erreur de traitement de l'image." }, { status: 500 });
  }
}
