import crypto from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import {
  readFile,
  keyFromDbPath,
  statFile,
  uploadFile,
} from "@/lib/storage";
import {
  ensureMinDimensions,
  guessContentType,
  isSafeMarketplaceImagePath,
  convertToJpeg,
  MIN_MARKETPLACE_WIDTH,
  MIN_MARKETPLACE_HEIGHT,
} from "@/lib/marketplace-image";
import { logger } from "@/lib/logger";
import { getCurrentTenantSlug } from "@/lib/tenant";

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

function cacheKeyFor(dbPath: string, format: "webp" | "jpeg" = "webp"): string {
  const hash = crypto.createHash("md5").update(dbPath).digest("hex");
  return `${CACHE_DIR}/${hash}.${format === "jpeg" ? "jpg" : "webp"}`;
}

export async function GET(request: NextRequest) {
  const url = new URL(request.url);
  const dbPath = url.searchParams.get("path");
  const format = url.searchParams.get("format") === "jpeg" ? "jpeg" : "webp";
  // Largeur minimale demandée — utile pour Faire qui exige ≥ 1000 px de large.
  // Par défaut on garde MIN_MARKETPLACE_WIDTH (500, suffisant pour Ankorstore).
  const minWidthParam = Number(url.searchParams.get("minWidth") ?? "");
  const minWidth =
    Number.isFinite(minWidthParam) && minWidthParam >= MIN_MARKETPLACE_WIDTH
      ? Math.min(Math.round(minWidthParam), 4000)
      : MIN_MARKETPLACE_WIDTH;
  // Hauteur minimale : par défaut on force MIN_MARKETPLACE_HEIGHT (500)
  // pour Ankorstore qui rejette toute image dont l'un des côtés est < 500.
  // Un client peut envoyer `?minHeight=0` pour désactiver le seuil (utilisé
  // en interne quand un appelant ne veut assurer que la largeur).
  const minHeightParam = Number(url.searchParams.get("minHeight") ?? "");
  const minHeight = Number.isFinite(minHeightParam)
    ? Math.min(Math.max(Math.round(minHeightParam), 0), 4000)
    : MIN_MARKETPLACE_HEIGHT;

  if (!isSafeMarketplaceImagePath(dbPath)) {
    return NextResponse.json({ error: "Chemin invalide." }, { status: 400 });
  }

  // Isolation multi-tenant : la boutique courante ne peut servir que ses propres
  // fichiers via ce proxy. Sinon un tenant compromis pourrait exfiltrer les
  // images d'un autre en devinant le chemin (`/uploads/{other-slug}/...`).
  const tenantSlug = await getCurrentTenantSlug();
  if (tenantSlug && !dbPath!.includes(`/uploads/${tenantSlug}/`)) {
    logger.warn("[Marketplace Image] Chemin hors boutique refusé", {
      tenantSlug,
      dbPath,
    });
    return NextResponse.json({ error: "Chemin hors boutique." }, { status: 403 });
  }

  const sourceKey = keyFromDbPath(dbPath);
  // Inclut les seuils dans la clé de cache pour éviter de servir une version
  // 500 px quand on a explicitement demandé 1000 px (et inversement).
  const cacheKey = cacheKeyFor(`${dbPath}|w${minWidth}|h${minHeight}`, format);
  const targetContentType = format === "jpeg" ? "image/jpeg" : "image/webp";

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
          "Content-Type": targetContentType,
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

  // ── 3. Upscale si nécessaire + conversion JPEG si demandée ─────
  try {
    const result = await ensureMinDimensions(buffer, minWidth, minHeight);

    let outBuffer = result.buffer;
    let contentType: string;

    if (format === "jpeg") {
      // Force JPEG quel que soit le format source (Faire refuse WebP).
      outBuffer = await convertToJpeg(result.buffer);
      contentType = "image/jpeg";
    } else {
      contentType = result.resized ? "image/webp" : guessContentType(dbPath);
    }

    // Écriture du cache : pour le JPEG on cache toujours (la conversion est
    // coûteuse), pour le WebP on cache uniquement les images effectivement
    // upscalées (les autres servies depuis le disque sont déjà rapides).
    if (format === "jpeg" || result.resized) {
      void uploadFile(cacheKey, outBuffer).catch((err) =>
        logger.warn("[Marketplace Image] Cache write failed", {
          path: dbPath,
          error: err,
        }),
      );
    }

    return new NextResponse(new Uint8Array(outBuffer), {
      status: 200,
      headers: {
        "Content-Type": contentType,
        "Content-Length": String(outBuffer.length),
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
