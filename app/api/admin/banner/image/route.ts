import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import sharp from "sharp";
import { uploadFile, bannerDir } from "@/lib/storage";
import { requireCurrentTenant } from "@/lib/tenant";
import { logger } from "@/lib/logger";

/**
 * POST /api/admin/banner/image
 * Upload de l'image de la bannière d'accueil → conversion WebP, format large (1920px).
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
    // Nom parlant + timestamp pour ne pas écraser une bannière précédente
    // (utile pour conserver un historique sur le lecteur réseau).
    const stamp = Date.now().toString(36);
    const filename = `accueil-${stamp}`;
    const dir = bannerDir(tenant.slug);

    // Banner: wide format, 1920px max width, auto height
    const oriented = sharp(buffer).rotate();

    const [largeBuffer, mediumBuffer] = await Promise.all([
      oriented
        .clone()
        .resize(1920, 800, { fit: "inside", withoutEnlargement: true })
        .webp({ lossless: true, quality: 100, effort: 4 })
        .toBuffer(),
      oriented
        .clone()
        .resize(960, 400, { fit: "inside", withoutEnlargement: true })
        .webp({ lossless: true, quality: 100, effort: 4 })
        .toBuffer(),
    ]);

    await Promise.all([
      uploadFile(`${dir}/${filename}.webp`, largeBuffer),
      uploadFile(`${dir}/${filename}-md.webp`, mediumBuffer),
    ]);

    const dbPath = `/${dir}/${filename}.webp`;

    return NextResponse.json({ path: dbPath });
  } catch (err) {
    logger.error("[banner/image] Processing error", { error: err });
    return NextResponse.json({ error: "Erreur de traitement de l'image." }, { status: 500 });
  }
}
