import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import sharp from "sharp";
import { uploadFile, mailBrandingDir } from "@/lib/storage";
import { requireCurrentTenant } from "@/lib/tenant";
import { logger } from "@/lib/logger";

/**
 * POST /api/admin/mail-branding/logo
 * Upload du logo affiché dans le header des mails marketing.
 * Sortie : PNG (transparence conservée), max 800 px de large.
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

  const allowedTypes = ["image/jpeg", "image/png", "image/webp", "image/svg+xml"];
  if (!allowedTypes.includes(file.type)) {
    return NextResponse.json(
      { error: "Format non supporté. Accepté : PNG, JPG, WEBP, SVG." },
      { status: 400 }
    );
  }

  if (file.size > 5 * 1024 * 1024) {
    return NextResponse.json(
      { error: "Fichier trop lourd (max 5 Mo)." },
      { status: 400 }
    );
  }

  try {
    const buffer = Buffer.from(await file.arrayBuffer());
    const stamp = Date.now().toString(36);
    const dir = mailBrandingDir(tenant.slug);

    // SVG passe tel quel — pas de rasterisation, préserve la netteté à toute taille.
    let outBuffer: Buffer;
    let ext: string;
    if (file.type === "image/svg+xml") {
      outBuffer = buffer;
      ext = "svg";
    } else {
      outBuffer = await sharp(buffer)
        .rotate()
        .resize(800, null, { fit: "inside", withoutEnlargement: true })
        .png({ compressionLevel: 9 })
        .toBuffer();
      ext = "png";
    }

    const filename = `logo-${stamp}.${ext}`;
    await uploadFile(`${dir}/${filename}`, outBuffer);
    const dbPath = `/${dir}/${filename}`;
    return NextResponse.json({ path: dbPath });
  } catch (err) {
    logger.error("[mail-branding/logo] Processing error", { error: err });
    return NextResponse.json({ error: "Erreur de traitement de l'image." }, { status: 500 });
  }
}
