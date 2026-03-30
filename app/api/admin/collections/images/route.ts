import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { processProductImage } from "@/lib/image-processor";
import { logger } from "@/lib/logger";

/**
 * POST /api/admin/collections/images
 * Upload d'une image de collection → conversion WebP + 3 tailles.
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
    const filename = `col_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

    const result = await processProductImage(buffer, "public/uploads/collections", filename);

    return NextResponse.json({ path: result.dbPath }, { status: 201 });
  } catch (err) {
    logger.error("[collections/images] Processing error", { error: err instanceof Error ? err.message : String(err) });
    return NextResponse.json({ error: "Erreur de traitement de l'image." }, { status: 500 });
  }
}
