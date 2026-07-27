/**
 * eFashion Paris — Upload photos via REST `/api/upload-product-photo` (multipart).
 *
 * 1 upload = 1 productId + 1 ou plusieurs fichiers photos. Format observé : JPEG.
 * On lit le fichier depuis le stockage local (`/public/uploads/...`) et on le
 * pousse en multipart.
 */

import { readFile } from "node:fs/promises";
import path from "node:path";

import sharp from "sharp";

import { ensureEfashionSession } from "@/lib/efashion-auth";
import { efashionFetch } from "@/lib/efashion-client";
import { logger } from "@/lib/logger";

export interface UploadPhotoResult {
  success: boolean;
  message?: string;
  photos: string[];
  nbPhotos: number;
}

/**
 * Convertit un chemin BDD ("/uploads/produits/.../foo.webp") en chemin disque.
 */
function dbPathToDiskPath(dbPath: string): string {
  const rel = dbPath.replace(/^\/+/, "");
  return path.resolve(process.cwd(), "public", rel);
}

/**
 * Liste les photos d'un produit-couleur eFashion.
 * Réponse : `{success, photos: ["/uploads/..."], nbPhotos}`.
 */
export async function efashionGetProductPhotos(
  efashionProductId: number,
): Promise<{ success: boolean; photos: string[]; nbPhotos: number }> {
  await ensureEfashionSession();
  const res = await efashionFetch(`/api/product-photos/${efashionProductId}`, { method: "GET" });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`eFashion get photos HTTP ${res.status}: ${text.slice(0, 200)}`);
  }
  return res.json();
}

/**
 * Réordonne les photos d'un produit. `positions` = tableau des suffixes
 * dans l'ordre voulu (ex: ["c", "z-1", "z-2"] → "c" en premier).
 *
 * Le suffixe correspond à la portion `xxx` dans le nom de fichier
 * `{idProduit}-{xxx}.jpg` (`c` = principale, `z-N` = secondaires).
 */
export async function efashionReorderProductPhotos(args: {
  efashionProductId: number;
  positions: string[];
}): Promise<{ success: boolean; photos: string[]; nbPhotos: number }> {
  await ensureEfashionSession();
  const res = await efashionFetch("/api/product-photos/reorder", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      productId: args.efashionProductId,
      positions: args.positions,
    }),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`eFashion reorder photos HTTP ${res.status}: ${text.slice(0, 200)}`);
  }
  return res.json();
}

/**
 * Supprime une photo précise (par nom de fichier complet, ex: "3662351-z-1.jpg").
 */
export async function efashionDeleteProductPhoto(args: {
  efashionProductId: number;
  filename: string;
}): Promise<{ success: boolean; photos: string[]; nbPhotos: number }> {
  await ensureEfashionSession();
  const res = await efashionFetch("/api/product-photo/delete", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      productId: args.efashionProductId,
      filename: args.filename,
    }),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`eFashion delete photo HTTP ${res.status}: ${text.slice(0, 200)}`);
  }
  return res.json();
}

/**
 * Upload 1 ou plusieurs photos pour un produit-couleur eFashion.
 *
 * @param efashionProductId  id_produit côté eFashion
 * @param photos             { dbPath, filename } — filename utilisé tel quel côté eFashion
 */
export async function efashionUploadProductPhotos(
  efashionProductId: number,
  photos: Array<{
    dbPath: string;
    filename: string;
    /**
     * Si présent, compose le badge « Réf » sur la photo AVANT la conversion
     * JPEG. Utilisé pour la 1ère image de la couleur principale quand le
     * toggle `branded_reference_badge_enabled` est actif.
     */
    brandedReference?: string;
  }>,
): Promise<UploadPhotoResult> {
  if (photos.length === 0) {
    return { success: true, photos: [], nbPhotos: 0 };
  }

  await ensureEfashionSession();

  const form = new FormData();
  for (const photo of photos) {
    const diskPath = dbPathToDiskPath(photo.dbPath);
    let sourceBuffer: Buffer;
    try {
      sourceBuffer = await readFile(diskPath);
    } catch (err) {
      throw new Error(
        `Impossible de lire l'image ${photo.dbPath} : ${err instanceof Error ? err.message : String(err)}`,
      );
    }
    // Optionnel : badge « Réf » composé sur la photo. Compose d'abord un
    // WebP puis JPEG-converti dessous — préserve la couleur/qualité de la
    // source pendant que le badge est appliqué proprement par Sharp.
    if (photo.brandedReference) {
      const { composeBrandedBuffer } = await import("@/lib/branded-image");
      sourceBuffer = await composeBrandedBuffer({
        sourceBuffer,
        reference: photo.brandedReference,
        size: "large",
      });
    }
    // eFashion attend strictement du JPEG (cf. docs/efashion-api.md §18.3 et
    // scripts/efashion-test-upload-photos.ts qui convertit aussi avec sharp).
    // Envoyer un WebP avec extension `.jpg` est rejeté ou produit des images
    // illisibles côté eFashion. On convertit ici, peu importe la source.
    const jpegBuffer = await sharp(sourceBuffer).jpeg({ quality: 90 }).toBuffer();
    // Force l'extension `.jpg` côté eFashion même si l'appelant a passé un
    // autre nom — protection en plus.
    const filename = photo.filename.toLowerCase().endsWith(".jpg")
      ? photo.filename
      : photo.filename.replace(/\.[a-z0-9]+$/i, "") + ".jpg";
    const blob = new Blob([new Uint8Array(jpegBuffer)], { type: "image/jpeg" });
    form.append("photos", blob, filename);
  }
  form.append("productId", String(efashionProductId));

  const res = await efashionFetch("/api/upload-product-photo", {
    method: "POST",
    body: form,
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`eFashion upload-product-photo HTTP ${res.status}: ${text.slice(0, 300)}`);
  }
  const json = (await res.json()) as UploadPhotoResult;
  logger.info("[eFashion] Photos uploaded", {
    efashionProductId,
    count: json.nbPhotos,
  });
  return json;
}
