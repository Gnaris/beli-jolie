import { NextRequest, NextResponse } from "next/server";
import { readFile, keyFromDbPath } from "@/lib/storage";
import {
  ensureMinWidth,
  guessContentType,
  isSafeMarketplaceImagePath,
  MIN_MARKETPLACE_WIDTH,
} from "@/lib/marketplace-image";
import { logger } from "@/lib/logger";

/**
 * GET /api/marketplace-image?path=/uploads/produits/.../xxx.webp
 *
 * Proxy d'image pour les marketplaces qui exigent une largeur minimale.
 * Lit le fichier local, vérifie ses dimensions :
 *  - Largeur ≥ 500px → renvoie le buffer original tel quel.
 *  - Largeur < 500px → upscale via sharp à exactement 500px de large
 *    (ratio préservé), encodé en WebP lossless.
 *
 * Aucune authentification : les images servies sont déjà publiques via
 * `/uploads/...`. Cette route ne fait que les re-servir avec une largeur
 * garantie minimale.
 */

export async function GET(request: NextRequest) {
  const dbPath = new URL(request.url).searchParams.get("path");

  if (!isSafeMarketplaceImagePath(dbPath)) {
    return NextResponse.json({ error: "Chemin invalide." }, { status: 400 });
  }

  let buffer: Buffer;
  try {
    buffer = await readFile(keyFromDbPath(dbPath));
  } catch (error) {
    logger.warn("[Marketplace Image] Fichier introuvable", { path: dbPath, error });
    return NextResponse.json({ error: "Image introuvable." }, { status: 404 });
  }

  try {
    const result = await ensureMinWidth(buffer, MIN_MARKETPLACE_WIDTH);
    const contentType = result.resized ? "image/webp" : guessContentType(dbPath);
    return new NextResponse(new Uint8Array(result.buffer), {
      status: 200,
      headers: {
        "Content-Type": contentType,
        "Content-Length": String(result.buffer.length),
        "Cache-Control": "public, max-age=31536000, immutable",
      },
    });
  } catch (error) {
    logger.error("[Marketplace Image] Erreur lors du traitement", {
      path: dbPath,
      error,
    });
    return NextResponse.json(
      { error: "Erreur de traitement d'image." },
      { status: 500 },
    );
  }
}
