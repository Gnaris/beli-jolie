import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { processProductImage } from "@/lib/image-processor";
import { collectionImageDir, slugify, withTenantSlug } from "@/lib/storage";
import { requireCurrentTenant } from "@/lib/tenant";
import { logger } from "@/lib/logger";

/**
 * POST /api/admin/collections/images
 * Upload d'une image de collection → conversion WebP + 3 tailles.
 *
 * FormData :
 *   - `image` : fichier (obligatoire)
 *   - `slug`  : slug de la collection (optionnel) — détermine le sous-dossier
 *
 * Sortie : `/uploads/collections/{slug}/couverture-XXXX.webp`.
 */
export async function POST(request: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session || session.user.role !== "ADMIN") {
    return NextResponse.json({ error: "Accès non autorisé." }, { status: 401 });
  }

  const tenant = await requireCurrentTenant();

  const formData = await request.formData();
  const file = formData.get("image") as File | null;
  const slug = ((formData.get("slug") as string | null) || "").trim();

  if (!file || file.size === 0) {
    return NextResponse.json({ error: "Aucun fichier reçu." }, { status: 400 });
  }

  const allowedTypes = ["image/jpeg", "image/png", "image/webp", "image/gif"];
  if (!allowedTypes.includes(file.type)) {
    return NextResponse.json(
      { error: "Format non supporté. Accepté : JPG, PNG, WEBP." },
      { status: 400 }
    );
  }

  if (file.size > 10 * 1024 * 1024) {
    return NextResponse.json(
      { error: "L'image ne doit pas dépasser 10 Mo." },
      { status: 400 }
    );
  }

  try {
    const buffer = Buffer.from(await file.arrayBuffer());
    const stamp = Date.now().toString(36);
    const destDir = slug
      ? collectionImageDir(slug, tenant.slug)
      : withTenantSlug("uploads/collections/_brouillon", tenant.slug);
    const basename = slug
      ? `${slugify(slug)}-couverture-${stamp}`
      : `couverture-${stamp}`;

    const result = await processProductImage(buffer, destDir, basename);

    return NextResponse.json({ path: result.dbPath }, { status: 201 });
  } catch (err) {
    logger.error("[collections/images] Processing error", { error: err });
    return NextResponse.json({ error: "Erreur de traitement de l'image." }, { status: 500 });
  }
}
