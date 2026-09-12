import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import sharp from "sharp";
import { uploadFile, aboutPhotoDir } from "@/lib/storage";
import { requireCurrentTenant } from "@/lib/tenant";
import { logger } from "@/lib/logger";

/**
 * POST /api/admin/about-photo/image
 * Upload d'une des 6 photos de la page « À propos ».
 * Format vertical (4:5), WebP, taille large 1200px + declinaison -md 600px.
 */
export async function POST(request: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session || session.user.role !== "ADMIN") {
    return NextResponse.json({ error: "Accès non autorisé." }, { status: 401 });
  }

  const tenant = await requireCurrentTenant();

  const formData = await request.formData();
  const file = formData.get("image") as File | null;
  const rawSlot = formData.get("slot");
  const slot = Number.parseInt(String(rawSlot ?? ""), 10);

  if (!Number.isInteger(slot) || slot < 1 || slot > 6) {
    return NextResponse.json({ error: "Emplacement invalide (1 à 6)." }, { status: 400 });
  }

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
    const stamp = Date.now().toString(36);
    const filename = `photo-${slot}-${stamp}`;
    const dir = aboutPhotoDir(tenant.slug);

    const oriented = sharp(buffer).rotate();

    const [largeBuffer, mediumBuffer] = await Promise.all([
      oriented
        .clone()
        .resize(1200, 1500, { fit: "cover", withoutEnlargement: true })
        .webp({ quality: 88, effort: 4 })
        .toBuffer(),
      oriented
        .clone()
        .resize(600, 750, { fit: "cover", withoutEnlargement: true })
        .webp({ quality: 85, effort: 4 })
        .toBuffer(),
    ]);

    await Promise.all([
      uploadFile(`${dir}/${filename}.webp`, largeBuffer),
      uploadFile(`${dir}/${filename}-md.webp`, mediumBuffer),
    ]);

    const dbPath = `/${dir}/${filename}.webp`;

    return NextResponse.json({ path: dbPath });
  } catch (err) {
    logger.error("[about-photo/image] Processing error", { error: err });
    return NextResponse.json({ error: "Erreur de traitement de l'image." }, { status: 500 });
  }
}
