import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import sharp from "sharp";
import { uploadFile, claimDir, withTenantSlug } from "@/lib/storage";
import { requireCurrentTenant } from "@/lib/tenant";
import { logger } from "@/lib/logger";

const MAX_FILES = 5;
const MAX_FILE_SIZE = 5 * 1024 * 1024; // 5 Mo
const ALLOWED_TYPES = ["image/jpeg", "image/png", "image/webp"];

/**
 * POST /api/client/claims/upload
 * Upload d'images pour pièces jointes réclamation → WebP → stockage privé.
 *
 * FormData :
 *   - `images` : 1 à 5 fichiers
 *   - `orderRef` : référence de la commande (optionnel) — détermine le sous-dossier
 *
 * Sortie : un tableau de paths privés (servis via `/api/client/claims/file/...`).
 */
export async function POST(request: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session || session.user.role !== "CLIENT" || session.user.status !== "APPROVED") {
    return NextResponse.json({ error: "Accès non autorisé." }, { status: 401 });
  }

  const tenant = await requireCurrentTenant();

  const formData = await request.formData();
  const files = formData.getAll("images") as File[];
  const orderRef = ((formData.get("orderRef") as string | null) || "").trim();

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
    // Si pas d'orderRef, on regroupe par client pour ne pas pourrir la racine.
    const dir = orderRef
      ? claimDir(orderRef, tenant.slug)
      : withTenantSlug(`uploads/reclamations/_brouillon/${session.user.id}`, tenant.slug);

    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      const buffer = Buffer.from(await file.arrayBuffer());
      const stamp = Date.now().toString(36);
      const filename = `photo-${i + 1}-${stamp}`;

      const webpBuffer = await sharp(buffer)
        .rotate()
        .resize(1200, 1200, { fit: "inside", withoutEnlargement: true })
        .webp({ lossless: true, quality: 100, effort: 4 })
        .toBuffer();

      const key = `${dir}/${filename}.webp`;
      await uploadFile(key, webpBuffer);

      paths.push(`/${key}`);
    }

    return NextResponse.json({ paths });
  } catch (err) {
    logger.error("[claims/upload] Processing error", {
      error: err,
    });
    return NextResponse.json({ error: "Erreur de traitement des images." }, { status: 500 });
  }
}
