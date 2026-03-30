/**
 * Image Processing Pipeline
 *
 * Converts any uploaded image to WebP format with 3 sizes:
 *   - thumb  (400px)  — lossy q100 — for lists, cart, grids
 *   - medium (800px)  — lossy q100 — for product cards, detail page
 *   - large  (1200px) — lossy q100 — for zoom, full quality
 *
 * Naming convention:
 *   DB stores:   /uploads/products/abc123.webp       (= large)
 *   On R2:       uploads/products/abc123.webp        (large)
 *                uploads/products/abc123_md.webp     (medium)
 *                uploads/products/abc123_thumb.webp  (thumb)
 *
 * Usage:
 *   const { dbPath } = await processProductImage(buffer, "public/uploads/products", "1710000000_1");
 *   // dbPath = "/uploads/products/1710000000_1.webp"
 *   // Also uploaded: _md.webp and _thumb.webp to R2
 */

import sharp from "sharp";
import { uploadToR2, r2PrefixFromDestDir } from "@/lib/r2";

// Re-export client-safe utilities (backward compat)
export { getImagePaths, getImageSrc } from "@/lib/image-utils";

// ─────────────────────────────────────────────
// Config
// ─────────────────────────────────────────────

const SIZES = {
  large:  { width: 1200, height: 1200, quality: 100 },
  medium: { width: 800,  height: 800,  quality: 100 },
  thumb:  { width: 400,  height: 400,  quality: 100 },
} as const;

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
 * Process a single image: convert to WebP, generate 3 sizes, upload to R2.
 *
 * @param buffer   Raw image buffer (any format: JPEG, PNG, GIF, TIFF, HEIC, BMP, WebP)
 * @param destDir  Logical directory (e.g. "public/uploads/products") — "public/" prefix is stripped for R2
 * @param filename Base filename without extension (e.g. "1710000000_1")
 */
export async function processProductImage(
  buffer: Buffer,
  destDir: string,
  filename: string,
): Promise<ProcessResult> {
  const prefix = r2PrefixFromDestDir(destDir);

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
      .webp({ quality: SIZES.large.quality })
      .toBuffer(),
    oriented
      .clone()
      .resize(SIZES.medium.width, SIZES.medium.height, { fit: "inside", withoutEnlargement: true })
      .webp({ quality: SIZES.medium.quality })
      .toBuffer(),
    oriented
      .clone()
      .resize(SIZES.thumb.width, SIZES.thumb.height, { fit: "inside", withoutEnlargement: true })
      .webp({ quality: SIZES.thumb.quality })
      .toBuffer(),
  ]);

  // Upload all 3 files to R2 in parallel
  await Promise.all([
    uploadToR2(webpKey, largeBuffer),
    uploadToR2(mdKey, mediumBuffer),
    uploadToR2(thumbKey, thumbBuffer),
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
