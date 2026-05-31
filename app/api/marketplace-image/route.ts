import crypto from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import {
  readFile,
  keyFromDbPath,
  statFile,
  uploadFile,
} from "@/lib/storage";
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
 * Cache disque des versions upscalées dans `public/uploads/.marketplace-cache/`
 * pour éviter de relancer sharp à chaque appel d'Ankorstore sur la même petite
 * image. Clé = md5 du chemin source ; on compare la mtime du cache à celle de
 * la source pour invalider automatiquement si le fichier d'origine a changé.
 * Le cas « image déjà ≥ 500px » ne passe pas par le cache (sharp.metadata est
 * suffisamment rapide pour qu'un fichier intermédiaire ne se justifie pas).
 *
 * Aucune authentification : les images servies sont déjà publiques via
 * `/uploads/...`. Cette route ne fait que les re-servir avec une largeur
 * garantie minimale.
 */

const CACHE_DIR = "uploads/.marketplace-cache";
const LONG_CACHE_HEADERS = {
  "Cache-Control": "public, max-age=31536000, immutable",
} as const;

function cacheKeyFor(dbPath: string): string {
  const hash = crypto.createHash("md5").update(dbPath).digest("hex");
  return `${CACHE_DIR}/${hash}.webp`;
}

export async function GET(request: NextRequest) {
  const dbPath = new URL(request.url).searchParams.get("path");

  if (!isSafeMarketplaceImagePath(dbPath)) {
    return NextResponse.json({ error: "Chemin invalide." }, { status: 400 });
  }

  const sourceKey = keyFromDbPath(dbPath);
  const cacheKey = cacheKeyFor(dbPath);

  // ── 1. Cache hit ? ──────────────────────────────────────────────
  // Si on a déjà une version upscalée et qu'elle est plus récente que la
  // source, on la sert directement sans toucher à sharp.
  try {
    const [sourceStat, cacheStat] = await Promise.all([
      statFile(sourceKey),
      statFile(cacheKey),
    ]);
    if (sourceStat && cacheStat && cacheStat.mtime >= sourceStat.mtime) {
      const cached = await readFile(cacheKey);
      return new NextResponse(new Uint8Array(cached), {
        status: 200,
        headers: {
          "Content-Type": "image/webp",
          "Content-Length": String(cached.length),
          ...LONG_CACHE_HEADERS,
        },
      });
    }
  } catch (error) {
    logger.warn("[Marketplace Image] Cache read failed", { path: dbPath, error });
  }

  // ── 2. Lire la source ──────────────────────────────────────────
  let buffer: Buffer;
  try {
    buffer = await readFile(sourceKey);
  } catch (error) {
    logger.warn("[Marketplace Image] Fichier introuvable", { path: dbPath, error });
    return NextResponse.json({ error: "Image introuvable." }, { status: 404 });
  }

  // ── 3. Upscale si nécessaire ───────────────────────────────────
  try {
    const result = await ensureMinWidth(buffer, MIN_MARKETPLACE_WIDTH);
    const contentType = result.resized ? "image/webp" : guessContentType(dbPath);

    // Écriture du cache uniquement quand on a réellement upscalé — pas la
    // peine de dupliquer les images déjà assez grandes. Fire-and-forget pour
    // ne pas retarder la réponse à Ankorstore.
    if (result.resized) {
      void uploadFile(cacheKey, result.buffer).catch((err) =>
        logger.warn("[Marketplace Image] Cache write failed", {
          path: dbPath,
          error: err,
        }),
      );
    }

    return new NextResponse(new Uint8Array(result.buffer), {
      status: 200,
      headers: {
        "Content-Type": contentType,
        "Content-Length": String(result.buffer.length),
        ...LONG_CACHE_HEADERS,
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
