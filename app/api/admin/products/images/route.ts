import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { processProductImage } from "@/lib/image-processor";
import {
  productImageDir,
  productImageBaseName,
  slugify,
} from "@/lib/storage";
import { logger } from "@/lib/logger";

/**
 * POST /api/admin/products/images
 *
 * Upload d'une image de produit → conversion WebP + 3 tailles.
 * L'image est rangée dans `public/uploads/produits/{ref}/` avec un nom
 * parlant `{ref}-{couleur}-{n}.webp` calculé à partir du `FormData` :
 *
 *   - `image`    : fichier (obligatoire)
 *   - `reference`: référence du produit en cours d'édition (obligatoire)
 *   - `color`    : nom de la couleur ou label multi-couleur "Brun+Kaki" (optionnel)
 *   - `position` : 1-based, optionnel — position cible de l'image
 *
 * Si `reference` est absente (ex : nouveau produit avant que l'admin ait
 * tapé la ref), l'image va dans `public/uploads/produits/_brouillon/` avec
 * un nom horodaté.
 *
 * Retourne `{ path: "/uploads/produits/{ref}/{ref}-{couleur}-{n}.webp" }`.
 */
export async function POST(request: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session || session.user.role !== "ADMIN") {
    return NextResponse.json({ error: "Accès non autorisé." }, { status: 401 });
  }

  const formData = await request.formData();
  const file = formData.get("image") as File | null;
  const reference = ((formData.get("reference") as string | null) || "").trim();
  const color = ((formData.get("color") as string | null) || "").trim();
  const positionRaw = (formData.get("position") as string | null) || "";
  const positionParsed = parseInt(positionRaw, 10);
  const position = Number.isFinite(positionParsed) && positionParsed > 0 ? positionParsed : 1;

  if (!file || file.size === 0) {
    return NextResponse.json({ error: "Aucun fichier reçu." }, { status: 400 });
  }

  const allowedTypes = ["image/jpeg", "image/png", "image/webp", "image/gif", "image/tiff", "image/bmp", "image/heic"];
  if (!allowedTypes.includes(file.type)) {
    return NextResponse.json(
      { error: "Format non supporté. Accepté : JPG, PNG, WEBP, GIF, TIFF, BMP." },
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

    // Reference present → ranger dans le dossier du produit avec un nom parlant.
    // Sans reference (très rare : tout début de création), on retombe sur un
    // sous-dossier brouillon avec un horodatage pour ne pas écraser.
    let destDir: string;
    let basename: string;
    if (reference) {
      destDir = productImageDir(reference);
      // Rajouter un suffixe horodaté pour ne pas écraser une image existante
      // au même slot (l'admin peut retélécharger plusieurs fois avant save).
      const stamp = Date.now().toString(36);
      const head = productImageBaseName(reference, color || null, position);
      basename = `${head}-${stamp}`;
    } else {
      destDir = "uploads/produits/_brouillon";
      const stamp = Date.now().toString(36);
      const colorPart = color ? `-${slugify(color)}` : "";
      basename = `brouillon${colorPart}-${stamp}`;
    }

    const result = await processProductImage(buffer, destDir, basename);

    return NextResponse.json({ path: result.dbPath }, { status: 201 });
  } catch (err) {
    logger.error("[products/images] Processing error", { error: err instanceof Error ? err.message : String(err) });
    return NextResponse.json({ error: "Erreur de traitement de l'image." }, { status: 500 });
  }
}
