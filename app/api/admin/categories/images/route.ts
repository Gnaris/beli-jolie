import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { processProductImage } from "@/lib/image-processor";
import { categoryImageDir } from "@/lib/storage";
import { requireCurrentTenant } from "@/lib/tenant";
import { logger } from "@/lib/logger";

/**
 * POST /api/admin/categories/images
 * Upload d'une image ronde de catégorie → conversion WebP + 3 tailles.
 *
 * FormData :
 *   - `image` : fichier (obligatoire)
 *   - `id`    : id de la catégorie (obligatoire) — détermine le sous-dossier
 *
 * Sortie : `/uploads/{tenant}/categories/{id}/{id}-illustration-XXXX.webp`.
 */
export async function POST(request: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session || session.user.role !== "ADMIN") {
    return NextResponse.json({ error: "Accès non autorisé." }, { status: 401 });
  }

  const tenant = await requireCurrentTenant();

  const formData = await request.formData();
  const file = formData.get("image") as File | null;
  const id = ((formData.get("id") as string | null) || "").trim();

  if (!file || file.size === 0) {
    return NextResponse.json({ error: "Aucun fichier reçu." }, { status: 400 });
  }
  if (!id) {
    return NextResponse.json({ error: "ID catégorie manquant." }, { status: 400 });
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
    const destDir = categoryImageDir(id, tenant.slug);
    const basename = `${id}-illustration-${stamp}`;

    const result = await processProductImage(buffer, destDir, basename);

    return NextResponse.json({ path: result.dbPath }, { status: 201 });
  } catch (err) {
    logger.error("[categories/images] Processing error", { error: err });
    return NextResponse.json({ error: "Erreur de traitement de l'image." }, { status: 500 });
  }
}
