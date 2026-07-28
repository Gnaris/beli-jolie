/**
 * Endpoint dynamique qui sert la 1ʳᵉ image d'un produit avec le badge « Réf »
 * en haut-droite, calculé à la volée. Aucun fichier n'est stocké sur disque —
 * la composition Sharp se fait à chaque hit non-caché (l'ETag rend la réponse
 * 304 instantanée sur les hits suivants).
 *
 * Usage :
 *   GET /api/branded-image?src=/uploads/beli-jolie/produits/g208a/g208a-doré-1.webp&ref=G208A&size=large
 *
 * Sécurité : seuls les paths sous `/uploads/{slug}/produits/…` sont acceptés
 * (protection contre l'escape du répertoire).
 *
 * Public : pas de session requise — la boutique publique et les marketplaces
 * doivent pouvoir fetch cette URL.
 */

import { NextRequest, NextResponse } from "next/server";
import sharp from "sharp";
import {
  composeBrandedBuffer,
  computeBrandedHash,
  type BrandedSize,
} from "@/lib/branded-image";
import { keyFromDbPath, readFile, statFile } from "@/lib/storage";
import { logger } from "@/lib/logger";

const ALLOWED_SIZES: readonly BrandedSize[] = ["large", "medium", "thumb"] as const;
const ALLOWED_FORMATS: readonly string[] = ["webp", "jpeg"] as const;

const SAFE_SRC_RE = /^\/uploads\/[a-z0-9-]+\/produits\/[^./][^?\s]*\.webp$/i;

export async function GET(req: NextRequest): Promise<Response> {
  const url = new URL(req.url);
  const src = url.searchParams.get("src");
  const ref = url.searchParams.get("ref");
  const sizeParam = (url.searchParams.get("size") ?? "large") as BrandedSize;
  const formatParam = (url.searchParams.get("format") ?? "webp").toLowerCase();
  const minWidthParam = url.searchParams.get("minWidth");

  if (!src || !ref) {
    return NextResponse.json({ error: "Paramètres src et ref requis." }, { status: 400 });
  }
  if (!ALLOWED_SIZES.includes(sizeParam)) {
    return NextResponse.json({ error: "Taille invalide (large|medium|thumb)." }, { status: 400 });
  }
  if (!ALLOWED_FORMATS.includes(formatParam)) {
    return NextResponse.json({ error: "Format invalide (webp|jpeg)." }, { status: 400 });
  }
  if (!SAFE_SRC_RE.test(src)) {
    return NextResponse.json({ error: "Source interdite." }, { status: 403 });
  }
  if (ref.length > 64) {
    return NextResponse.json({ error: "Référence trop longue." }, { status: 400 });
  }

  let minWidth = 0;
  if (minWidthParam !== null) {
    const parsed = Number(minWidthParam);
    if (!Number.isFinite(parsed) || parsed < 100 || parsed > 4000) {
      return NextResponse.json(
        { error: "minWidth invalide (100-4000)." },
        { status: 400 },
      );
    }
    minWidth = Math.round(parsed);
  }

  const key = keyFromDbPath(src);
  const stat = await statFile(key);
  if (!stat) {
    return NextResponse.json({ error: "Image source introuvable." }, { status: 404 });
  }

  const etag = `"${computeBrandedHash(src, ref, sizeParam, minWidth)}-${formatParam}-${stat.mtime.getTime().toString(36)}"`;
  const ifNoneMatch = req.headers.get("if-none-match");
  if (ifNoneMatch === etag) {
    return new Response(null, {
      status: 304,
      headers: {
        ETag: etag,
        "Cache-Control": "public, max-age=3600, s-maxage=86400, stale-while-revalidate=604800",
      },
    });
  }

  try {
    const sourceBuffer = await readFile(key);
    const composed = await composeBrandedBuffer({
      sourceBuffer,
      reference: ref,
      size: sizeParam,
      minWidth: minWidth || undefined,
    });
    let output = composed;
    let contentType = "image/webp";
    if (formatParam === "jpeg") {
      output = await sharp(composed)
        .jpeg({ quality: 90, progressive: true, mozjpeg: true })
        .toBuffer();
      contentType = "image/jpeg";
    }
    return new Response(new Uint8Array(output), {
      status: 200,
      headers: {
        "Content-Type": contentType,
        "Content-Length": String(output.length),
        ETag: etag,
        "Cache-Control": "public, max-age=3600, s-maxage=86400, stale-while-revalidate=604800",
      },
    });
  } catch (err) {
    logger.error("[branded-image] composition échouée", { src, ref, error: err });
    return NextResponse.json({ error: "Composition échouée." }, { status: 500 });
  }
}
