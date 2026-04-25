/**
 * Image Processing Pipeline
 *
 * Converts any uploaded image to WebP format with 3 sizes:
 *   - thumb  (400px)  — lossless WebP — for lists, cart, grids
 *   - medium (800px)  — lossless WebP — for product cards, detail page
 *   - large  (1200px) — lossless WebP — for zoom, full quality
 *
 * Naming convention:
 *   DB stores: /uploads/products/abc123.webp       (= large)
 *   On disk:   public/uploads/products/abc123.webp        (large)
 *              public/uploads/products/abc123_md.webp     (medium)
 *              public/uploads/products/abc123_thumb.webp  (thumb)
 *
 * Usage:
 *   const { dbPath } = await processProductImage(buffer, "public/uploads/products", "1710000000_1");
 *   // dbPath = "/uploads/products/1710000000_1.webp"
 *   // Also written: _md.webp and _thumb.webp
 */

import sharp from "sharp";
import { uploadFile, keyPrefixFromDestDir } from "@/lib/storage";

// Re-export client-safe utilities (backward compat)
export { getImagePaths, getImageSrc } from "@/lib/image-utils";

// ─────────────────────────────────────────────
// Config
// ─────────────────────────────────────────────

const SIZES = {
  large:  { width: 1200, height: 1200 },
  medium: { width: 800,  height: 800 },
  thumb:  { width: 400,  height: 400 },
} as const;

const WEBP_OPTS = { lossless: true, quality: 100, effort: 4 } as const;

// ─────────────────────────────────────────────
// Processing
// ─────────────────────────────────────────────

interface ProcessResult {
  /** Path stored in DB (large version), e.g. "/uploads/products/abc123.webp" */
  dbPath: string;
  /** Sizes in bytes */
  sizes: { large: number; medium: number; thumb: number };
}

/**
 * Process a single image: convert to WebP, generate 3 sizes, write to local storage.
 *
 * @param buffer   Raw image buffer (any format: JPEG, PNG, GIF, TIFF, HEIC, BMP, WebP)
 * @param destDir  Logical directory (e.g. "public/uploads/products") — "public/" prefix is stripped
 * @param filename Base filename without extension (e.g. "1710000000_1")
 */
export async function processProductImage(
  buffer: Buffer,
  destDir: string,
  filename: string,
): Promise<ProcessResult> {
  const prefix = keyPrefixFromDestDir(destDir);

  const webpKey = `${prefix}/${filename}.webp`;
  const mdKey = `${prefix}/${filename}_md.webp`;
  const thumbKey = `${prefix}/${filename}_thumb.webp`;

  // Auto-rotate based on EXIF orientation before resizing (fixes rotated images from bulk import)
  const oriented = sharp(buffer).rotate();

  // Process all 3 sizes in parallel
  const [largeBuffer, mediumBuffer, thumbBuffer] = await Promise.all([
    oriented
      .clone()
      .resize(SIZES.large.width, SIZES.large.height, { fit: "inside", withoutEnlargement: true })
      .webp(WEBP_OPTS)
      .toBuffer(),
    oriented
      .clone()
      .resize(SIZES.medium.width, SIZES.medium.height, { fit: "inside", withoutEnlargement: true })
      .webp(WEBP_OPTS)
      .toBuffer(),
    oriented
      .clone()
      .resize(SIZES.thumb.width, SIZES.thumb.height, { fit: "inside", withoutEnlargement: true })
      .webp(WEBP_OPTS)
      .toBuffer(),
  ]);

  // Write all 3 files in parallel
  await Promise.all([
    uploadFile(webpKey, largeBuffer),
    uploadFile(mdKey, mediumBuffer),
    uploadFile(thumbKey, thumbBuffer),
  ]);

  // DB path keeps the leading slash for backward compat
  const dbPath = `/${prefix}/${filename}.webp`;

  return {
    dbPath,
    sizes: {
      large: largeBuffer.length,
      medium: mediumBuffer.length,
      thumb: thumbBuffer.length,
    },
  };
}

/**
 * Process a batch of images (used by import processor).
 * Returns array of results in same order as input.
 */
export async function processProductImageBatch(
  images: { buffer: Buffer; filename: string }[],
  destDir: string,
): Promise<ProcessResult[]> {
  // Process 5 at a time to avoid memory spikes
  const CONCURRENCY = 5;
  const results: ProcessResult[] = [];

  for (let i = 0; i < images.length; i += CONCURRENCY) {
    const batch = images.slice(i, i + CONCURRENCY);
    const batchResults = await Promise.all(
      batch.map((img) => processProductImage(img.buffer, destDir, img.filename))
    );
    results.push(...batchResults);
  }

  return results;
}
