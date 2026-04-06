import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import sharp from "sharp";
import { uploadToR2 } from "@/lib/r2";
import { logger } from "@/lib/logger";

const MAX_FILES = 5;
const MAX_FILE_SIZE = 5 * 1024 * 1024; // 5 Mo
const ALLOWED_TYPES = ["image/jpeg", "image/png", "image/webp"];

/**
 * POST /api/client/claims/upload
 * Upload d'images pour pièces jointes réclamation → WebP → R2.
 * Retourne un tableau de paths stockés en BDD.
 */
export async function POST(request: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session || session.user.role !== "CLIENT" || session.user.status !== "APPROVED") {
    return NextResponse.json({ error: "Accès non autorisé." }, { status: 401 });
  }

  const formData = await request.formData();
  const files = formData.getAll("images") as File[];

  if (!files.length) {
    return NextResponse.json({ error: "Aucun fichier reçu." }, { status: 400 });
  }

  if (files.length > MAX_FILES) {
    return NextResponse.json({ error: `Maximum ${MAX_FILES} images.` }, { status: 400 });
  }

  for (const file of files) {
    if (!ALLOWED_TYPES.includes(file.type)) {
      return NextResponse.json(
        { error: `Format non supporté : ${file.name}. Accepté : JPG, PNG, WEBP.` },
        { status: 400 },
      );
    }
    if (file.size > MAX_FILE_SIZE) {
      return NextResponse.json(
        { error: `${file.name} dépasse 5 Mo.` },
        { status: 400 },
      );
    }
  }

  try {
    const paths: string[] = [];

    for (const file of files) {
      const buffer = Buffer.from(await file.arrayBuffer());
      const filename = `claim-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

      const webpBuffer = await sharp(buffer)
        .rotate()
        .resize(1200, 1200, { fit: "inside", withoutEnlargement: true })
        .webp({ quality: 85 })
        .toBuffer();

      const r2Key = `uploads/claims/${filename}.webp`;
      await uploadToR2(r2Key, webpBuffer);

      paths.push(`/${r2Key}`);
    }

    return NextResponse.json({ paths });
  } catch (err) {
    logger.error("[claims/upload] Processing error", {
      error: err instanceof Error ? err.message : String(err),
    });
    return NextResponse.json({ error: "Erreur de traitement des images." }, { status: 500 });
  }
}
