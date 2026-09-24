import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import sharp from "sharp";
import { uploadFile, chatAttachmentDir, slugify } from "@/lib/storage";
import { requireCurrentTenant } from "@/lib/tenant";
import { logger } from "@/lib/logger";
import {
  ALLOWED_MIMES,
  ALLOWED_IMAGE_MIMES,
  validateFileName,
  verifyMagicBytes,
} from "@/lib/chat-upload-security";

const MAX_FILES = 5;
const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10 Mo

/**
 * POST /api/chat/upload
 * Upload de pièces jointes du chat (images + documents bureautiques).
 *
 * Couches de sécurité :
 *   1. Session obligatoire (client APPROVED ou admin).
 *   2. Whitelist stricte MIME + extension (lib/chat-upload-security).
 *   3. Vérification des octets magiques du fichier (anti-renommage).
 *   4. Refus des doubles extensions dangereuses.
 *   5. Renommage aléatoire côté serveur (slug + timestamp + random).
 *   6. Stockage isolé par boutique (uploads/{tenant}/temp/chat/).
 *   7. Images ré-encodées via sharp (élimine toute charge cachée dans les
 *      métadonnées EXIF ou après la fin d'image).
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

  // Pré-validation : nom, MIME déclaré, taille.
  for (const file of files) {
    const nameCheck = validateFileName(file.name);
    if (!nameCheck.ok) {
      return NextResponse.json({ error: `${file.name} : ${nameCheck.error}` }, { status: 400 });
    }
    if (!ALLOWED_MIMES.includes(file.type)) {
      return NextResponse.json(
        { error: `Format non supporté : ${file.name}. Types acceptés : images, PDF, Word, Excel, PowerPoint, texte.` },
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

      // Signature (magic bytes) — refuse un binaire déguisé en PDF/Office/image.
      if (!verifyMagicBytes(file.type, buffer)) {
        return NextResponse.json(
          { error: `${file.name} : le contenu ne correspond pas au type déclaré.` },
          { status: 400 },
        );
      }

      const stamp = Date.now().toString(36);
      const rand = Math.random().toString(36).slice(2, 8);
      const original = slugify(file.name.replace(/\.[^.]+$/, "")).slice(0, 40) || "chat";
      const filename = `${original}-${stamp}-${rand}`;

      // Images : ré-encodage sharp → WebP. Nettoie EXIF + supprime toute
      // charge annexée après l'IEND (technique de dissimulation classique).
      // Exception HEIC : sharp lit HEIC seulement si libheif compilé — on
      // stocke tel quel après validation magic bytes.
      const isImage = (ALLOWED_IMAGE_MIMES as readonly string[]).includes(file.type);
      const canReencode = isImage && file.type !== "image/heic" && file.type !== "image/heif";

      if (canReencode) {
        const webpBuffer = await sharp(buffer)
          .rotate()
          .resize(1600, 1600, { fit: "inside", withoutEnlargement: true })
          .webp({ quality: 88, effort: 4 })
          .toBuffer();
        const key = `${dir}/${filename}.webp`;
        await uploadFile(key, webpBuffer);
        attachments.push({
          fileName: file.name,
          filePath: `/${key}`,
          fileSize: webpBuffer.length,
          mimeType: "image/webp",
        });
        continue;
      }

      // Documents + HEIC : stockage brut après validation magic bytes.
      // Extension récupérée depuis le nom validé, pas depuis le MIME (les
      // MIME Office sont ambigus pour l'extension exacte).
      const parts = file.name.toLowerCase().split(".");
      const ext = parts[parts.length - 1];
      const key = `${dir}/${filename}.${ext}`;
      await uploadFile(key, buffer);
      attachments.push({
        fileName: file.name,
        filePath: `/${key}`,
        fileSize: buffer.length,
        mimeType: file.type,
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
