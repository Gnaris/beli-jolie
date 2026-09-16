import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import sharp from "sharp";
import { uploadFile, chatAttachmentDir, slugify } from "@/lib/storage";
import { requireCurrentTenant } from "@/lib/tenant";
import { logger } from "@/lib/logger";

const MAX_FILES = 5;
const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10 Mo
const ALLOWED_IMAGE_TYPES = ["image/jpeg", "image/png", "image/webp"];
const ALLOWED_DOC_TYPES = ["application/pdf"];
const ALLOWED_TYPES = [...ALLOWED_IMAGE_TYPES, ...ALLOWED_DOC_TYPES];

/**
 * POST /api/chat/upload
 * Upload images for chat message attachments → WebP → local storage.
 * Returns array of { fileName, filePath, fileSize, mimeType }.
 */
export async function POST(request: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session) {
    return NextResponse.json({ error: "Accès non autorisé." }, { status: 401 });
  }

  const tenant = await requireCurrentTenant();

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
        { error: `Format non supporté : ${file.name}. Accepté : JPG, PNG, WEBP, PDF.` },
        { status: 400 },
      );
    }
    if (file.size > MAX_FILE_SIZE) {
      return NextResponse.json(
        { error: `${file.name} dépasse 10 Mo.` },
        { status: 400 },
      );
    }
  }

  try {
    const attachments: { fileName: string; filePath: string; fileSize: number; mimeType: string }[] = [];

    const dir = chatAttachmentDir(tenant.slug);
    for (const file of files) {
      const buffer = Buffer.from(await file.arrayBuffer());
      const stamp = Date.now().toString(36);
      const rand = Math.random().toString(36).slice(2, 8);
      const original = slugify(file.name.replace(/\.[^.]+$/, "")).slice(0, 40) || "chat";
      const filename = `${original}-${stamp}-${rand}`;

      if (ALLOWED_DOC_TYPES.includes(file.type)) {
        const key = `${dir}/${filename}.pdf`;
        await uploadFile(key, buffer);
        attachments.push({
          fileName: file.name,
          filePath: `/${key}`,
          fileSize: buffer.length,
          mimeType: file.type,
        });
        continue;
      }

      const webpBuffer = await sharp(buffer)
        .rotate()
        .resize(1200, 1200, { fit: "inside", withoutEnlargement: true })
        .webp({ lossless: true, quality: 100, effort: 4 })
        .toBuffer();

      const key = `${dir}/${filename}.webp`;
      await uploadFile(key, webpBuffer);

      attachments.push({
        fileName: file.name,
        filePath: `/${key}`,
        fileSize: webpBuffer.length,
        mimeType: "image/webp",
      });
    }

    return NextResponse.json({ attachments });
  } catch (err) {
    logger.error("[chat/upload] Processing error", {
      error: err,
    });
    return NextResponse.json({ error: "Erreur de traitement du fichier." }, { status: 500 });
  }
}
