import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import sharp from "sharp";
import { uploadFile, brandLogoDir } from "@/lib/storage";
import { requireCurrentTenant } from "@/lib/tenant";
import { logger } from "@/lib/logger";

/**
 * POST /api/admin/logo/image
 *
 * Upload du logo de marque utilisé par Google (JSON-LD Organization) + image
 * Open Graph fallback. On génère un PNG carré 512×512, taille recommandée par
 * Google (>= 112×112 requis, 512×512 pour couvrir écrans Retina + preview OG).
 *
 * Retourne `{ url }` — chemin public à stocker dans SiteConfig `site_logo_url`.
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
      { error: "Format non supporté. Accepté : JPG, PNG, WEBP, SVG." },
      { status: 400 },
    );
  }
  if (file.size > 5 * 1024 * 1024) {
    return NextResponse.json({ error: "Fichier trop lourd (max 5 Mo)." }, { status: 400 });
  }

  try {
    const buffer = Buffer.from(await file.arrayBuffer());
    const stamp = Date.now().toString(36);
    const dir = brandLogoDir(tenant.slug);

    // `fit: "contain"` + fond blanc : préserve les logos non carrés (ne recadre
    // pas comme le favicon) — indispensable pour un logo qui doit rester lisible
    // dans les vignettes Google.
    const png = await sharp(buffer, { failOn: "none" })
      .rotate()
      .resize(512, 512, {
        fit: "contain",
        background: { r: 255, g: 255, b: 255, alpha: 1 },
      })
      .png({ compressionLevel: 9 })
      .toBuffer();

    const key = `${dir}/logo-${stamp}.png`;
    await uploadFile(key, png);

    return NextResponse.json({ url: `/${key}` });
  } catch (err) {
    logger.error("[logo/image] Processing error", { error: err });
    return NextResponse.json({ error: "Erreur de traitement de l'image." }, { status: 500 });
  }
}
