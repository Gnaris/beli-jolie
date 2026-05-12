import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import sharp from "sharp";
import { uploadFile, faviconDir } from "@/lib/storage";
import { logger } from "@/lib/logger";

/**
 * POST /api/admin/favicon/image
 * Upload the site favicon → generate two PNGs:
 *   - 32×32  (browser tab, /icon)
 *   - 180×180 (Apple touch icon, /apple-icon)
 *
 * Returns { icon, appleIcon } public paths. The caller stores them in
 * the `site_favicon` SiteConfig row (JSON-encoded).
 */
export async function POST(request: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session || session.user.role !== "ADMIN") {
    return NextResponse.json({ error: "Accès non autorisé." }, { status: 401 });
  }

  const formData = await request.formData();
  const file = formData.get("image") as File | null;

  if (!file || file.size === 0) {
    return NextResponse.json({ error: "Aucun fichier reçu." }, { status: 400 });
  }

  const allowedTypes = ["image/jpeg", "image/png", "image/webp", "image/svg+xml"];
  if (!allowedTypes.includes(file.type)) {
    return NextResponse.json(
      { error: "Format non supporté. Accepté : JPG, PNG, WEBP, SVG." },
      { status: 400 },
    );
  }

  if (file.size > 5 * 1024 * 1024) {
    return NextResponse.json(
      { error: "Fichier trop lourd (max 5 Mo)." },
      { status: 400 },
    );
  }

  try {
    const buffer = Buffer.from(await file.arrayBuffer());
    const stamp = Date.now().toString(36);
    const dir = faviconDir();

    const oriented = sharp(buffer, { failOn: "none" }).rotate();

    const [icon32, icon180] = await Promise.all([
      oriented
        .clone()
        .resize(32, 32, { fit: "cover", position: "center" })
        .png({ compressionLevel: 9 })
        .toBuffer(),
      oriented
        .clone()
        .resize(180, 180, { fit: "cover", position: "center" })
        .png({ compressionLevel: 9 })
        .toBuffer(),
    ]);

    const iconKey = `${dir}/icon-${stamp}.png`;
    const appleKey = `${dir}/apple-icon-${stamp}.png`;

    await Promise.all([
      uploadFile(iconKey, icon32),
      uploadFile(appleKey, icon180),
    ]);

    return NextResponse.json({
      icon: `/${iconKey}`,
      appleIcon: `/${appleKey}`,
    });
  } catch (err) {
    logger.error("[favicon/image] Processing error", { error: err });
    return NextResponse.json(
      { error: "Erreur de traitement de l'image." },
      { status: 500 },
    );
  }
}
