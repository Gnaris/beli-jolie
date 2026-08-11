import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import sharp from "sharp";
import { uploadFile, withTenantSlug } from "@/lib/storage";
import { requireCurrentTenant } from "@/lib/tenant";
import { logger } from "@/lib/logger";

/**
 * POST /api/admin/newsletter-image
 * Upload d'une image utilisée dans une newsletter (bannière, imgtext, colonnes).
 * Conversion WebP, largeur max 1200 px (bien plus large que 600 px du mail
 * pour rester nette sur écrans Retina).
 */
export async function POST(request: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session || session.user.role !== "ADMIN") {
    return NextResponse.json({ error: "Accès non autorisé." }, { status: 401 });
  }

  const tenant = await requireCurrentTenant();

  const formData = await request.formData();
  const file = formData.get("image") as File | null;

  if (!file || file.size === 0) {
    return NextResponse.json({ error: "Aucun fichier reçu." }, { status: 400 });
  }

  const allowedTypes = ["image/jpeg", "image/png", "image/webp", "image/gif"];
  if (!allowedTypes.includes(file.type)) {
    return NextResponse.json({ error: "Format non supporté. Accepté : JPG, PNG, WEBP, GIF." }, { status: 400 });
  }

  if (file.size > 10 * 1024 * 1024) {
    return NextResponse.json({ error: "Fichier trop lourd (max 10 Mo)." }, { status: 400 });
  }

  try {
    const buffer = Buffer.from(await file.arrayBuffer());
    const stamp = Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
    const filename = `img-${stamp}.webp`;
    const dir = withTenantSlug("uploads/newsletters", tenant.slug);

    const webpBuffer = await sharp(buffer)
      .rotate()
      .resize(1200, 1200, { fit: "inside", withoutEnlargement: true })
      .webp({ quality: 88, effort: 4 })
      .toBuffer();

    await uploadFile(`${dir}/${filename}`, webpBuffer);
    const dbPath = `/${dir}/${filename}`;

    return NextResponse.json({ path: dbPath });
  } catch (err) {
    logger.error("[newsletter-image] Processing error", { error: err });
    return NextResponse.json({ error: "Erreur de traitement de l'image." }, { status: 500 });
  }
}
