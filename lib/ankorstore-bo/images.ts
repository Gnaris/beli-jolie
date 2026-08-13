/**
 * Upload d'images vers le back-office Ankorstore.
 *
 * Endpoint : POST /api/files (multipart, champ unique `file`).
 * Retour : { data: { key: "file-upload:<hash>.<ext>", url, original_name } }
 *
 * RÈGLES DE ROBUSTESSE (bug côté Ankor confirmé dans le HAR "Image ankorstore.har") :
 * - Le 200 sur /api/files signifie "reçu dans le bucket GCS", PAS "ingéré".
 * - Uploads en parallèle → un ou plusieurs sont perdus silencieusement.
 * - Il faut sérialiser strictement et attendre entre chaque upload.
 * - Les images de variantes sont particulièrement fragiles → retry post-PUT
 *   quand elles reviennent null.
 */

import { boPostMultipart } from "./client";
import { logger } from "@/lib/logger";
import type { BoUploadResult } from "./types";

/** Délai entre 2 uploads consécutifs pour laisser Ankor finir l'ingestion GCS. */
const DELAY_BETWEEN_UPLOADS_MS = 1500;

/** Délai entre le dernier upload et un save PUT — plus long, pour être safe. */
const DELAY_UPLOADS_TO_SAVE_MS = 3000;

export interface UploadableImage {
  /** Contenu binaire du fichier. */
  buffer: Buffer | Uint8Array;
  /** Nom original (informatif, sert au tracking Ankor). */
  filename: string;
  /** MIME type (défaut inféré depuis extension). */
  mimeType?: string;
}

interface RawUploadResponse {
  data?: {
    type?: string;
    original_name?: string;
    url?: string;
    key?: string;
  };
}

/**
 * Upload d'UN seul fichier. Ne pas appeler en parallèle.
 * Pour un lot, utiliser `uploadImagesSequential` qui sérialise et ajoute des délais.
 */
export async function uploadImage(img: UploadableImage): Promise<BoUploadResult> {
  const mime = img.mimeType ?? inferMimeType(img.filename);
  const src = img.buffer instanceof Uint8Array ? img.buffer : new Uint8Array(img.buffer);
  // Copie dans un ArrayBuffer natif pour éviter le mismatch Buffer<ArrayBufferLike> vs BlobPart.
  const ab = new ArrayBuffer(src.byteLength);
  new Uint8Array(ab).set(src);
  const blob = new Blob([ab], { type: mime });
  const form = new FormData();
  form.append("file", blob, img.filename);

  const res = await boPostMultipart<RawUploadResponse>("/api/files", form);
  if (!res.data?.key || !res.data?.url) {
    throw new Error(
      `Ankorstore : upload image "${img.filename}" a répondu 200 mais sans key/url exploitable`
    );
  }
  return {
    key: res.data.key,
    url: res.data.url,
    originalName: res.data.original_name ?? img.filename,
  };
}

/**
 * Upload SÉQUENTIEL d'une liste d'images avec délai entre chaque.
 * IMPÉRATIF pour éviter le bug de race Ankor.
 *
 * @param images liste dans l'ordre d'affichage souhaité
 * @param opts.delayMs délai entre chaque upload (défaut 1500 ms)
 * @param opts.onProgress callback (index, total) après chaque upload
 */
export async function uploadImagesSequential(
  images: UploadableImage[],
  opts: {
    delayMs?: number;
    onProgress?: (uploadedIndex: number, total: number) => void;
  } = {}
): Promise<BoUploadResult[]> {
  const delayMs = opts.delayMs ?? DELAY_BETWEEN_UPLOADS_MS;
  const results: BoUploadResult[] = [];
  for (let i = 0; i < images.length; i++) {
    const r = await uploadImage(images[i]);
    results.push(r);
    opts.onProgress?.(i, images.length);
    if (i < images.length - 1) {
      await sleep(delayMs);
    }
  }
  return results;
}

/**
 * Attend le délai recommandé entre le dernier upload et le PUT du produit.
 * À appeler explicitement avant `updateProduct` quand on vient d'uploader.
 */
export async function waitForUploadsIngestion(): Promise<void> {
  await sleep(DELAY_UPLOADS_TO_SAVE_MS);
}

/**
 * Détecte si une variante a "perdu" ses images après un PUT (bug Ankor connu).
 * Utilisé par update.ts pour décider d'un retry ciblé.
 */
export function hasLostVariantImages(
  expectedByVariantId: Map<number, unknown[]>,
  actualByVariantId: Map<number, unknown[] | null>
): number[] {
  const lost: number[] = [];
  for (const [vid, expected] of expectedByVariantId.entries()) {
    if (expected.length === 0) continue;
    const actual = actualByVariantId.get(vid);
    if (!actual || actual.length === 0) {
      lost.push(vid);
    }
  }
  return lost;
}

function inferMimeType(filename: string): string {
  const ext = filename.toLowerCase().split(".").pop() ?? "";
  switch (ext) {
    case "jpg":
    case "jpeg":
      return "image/jpeg";
    case "png":
      return "image/png";
    case "webp":
      return "image/webp";
    case "gif":
      return "image/gif";
    default:
      return "application/octet-stream";
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/**
 * Wrapper : upload d'une liste + log de progression. Pour les workers.
 */
export async function uploadImagesWithLogging(
  images: UploadableImage[],
  context: { productId?: number; label?: string } = {}
): Promise<BoUploadResult[]> {
  const start = Date.now();
  const results = await uploadImagesSequential(images, {
    onProgress: (i, total) => {
      logger.info("[ankorstore-bo] upload image", {
        ...context,
        i: i + 1,
        total,
      });
    },
  });
  logger.info("[ankorstore-bo] uploads terminés", {
    ...context,
    count: results.length,
    ms: Date.now() - start,
  });
  return results;
}
