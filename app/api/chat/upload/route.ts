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
 * POST /api/chat/upload
 * Upload images for chat message attachments → WebP → R2.
 * Returns array of { fileName, filePath, fileSize, mimeType }.
 */
export async function POST(request: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session) {
    return NextResponse.json({ error: "Accès non autorisé." }, { status: 401 });
  }

  const formData = await request.formData();
  const files = formData.getAll("files") as File[];

  if (!files.length) {
    return NextResponse.json({ error: "Aucun fichier reçu." }, { status: 400 });
  }

  if (files.length > MAX_FILES) {
    return NextResponse.json({ error: `Maximum ${MAX_FILES} fichiers.` }, { status: 400 });
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
    const attachments: { fileName: string; filePath: string; fileSize: number; mimeType: string }[] = [];

    for (const file of files) {
      const buffer = Buffer.from(await file.arrayBuffer());
      const filename = `chat-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

      const webpBuffer = await sharp(buffer)
        .rotate()
        .resize(1200, 1200, { fit: "inside", withoutEnlargement: true })
        .webp({ quality: 85 })
        .toBuffer();

      const r2Key = `uploads/chat/${filename}.webp`;
      await uploadToR2(r2Key, webpBuffer);

      attachments.push({
        fileName: file.name,
        filePath: `/${r2Key}`,
        fileSize: webpBuffer.length,
        mimeType: "image/webp",
      });
    }

    return NextResponse.json({ attachments });
  } catch (err) {
    logger.error("[chat/upload] Processing error", {
      error: err instanceof Error ? err.message : String(err),
    });
    return NextResponse.json({ error: "Erreur de traitement des images." }, { status: 500 });
  }
}
