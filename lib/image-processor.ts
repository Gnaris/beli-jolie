/**
 * Image Processing Pipeline
 *
 * Converts any uploaded image to WebP format with 3 sizes:
 *   - thumb  (400px)  — lossy q80  — for lists, cart, grids
 *   - medium (800px)  — lossy q82  — for product cards, detail page
 *   - large  (1200px) — lossy q90  — for zoom, full quality
 *
 * Naming convention:
 *   DB stores:   /uploads/products/abc123.webp       (= large)
 *   On disk:     abc123.webp        (large)
 *                abc123_md.webp     (medium)
 *                abc123_thumb.webp  (thumb)
 *
 * Usage:
 *   const { basePath } = await processProductImage(buffer, "uploads/products");
 *   // basePath = "/uploads/products/1710000000_1.webp"
 *   // Also created: _md.webp and _thumb.webp
 */

import sharp from "sharp";
import { writeFile, mkdir } from "fs/promises";
import path from "path";

// ─────────────────────────────────────────────
// Config
// ─────────────────────────────────────────────

const SIZES = {
  large:  { width: 1200, height: 1200, quality: 90 },
  medium: { width: 800,  height: 800,  quality: 82 },
  thumb:  { width: 400,  height: 400,  quality: 80 },
} as const;

// ─────────────────────────────────────────────
// Path helpers
// ─────────────────────────────────────────────

/**
 * From a stored DB path (large), derive thumb and medium paths.
 * Input:  "/uploads/products/abc123.webp"
 * Output: { large: "...abc123.webp", medium: "...abc123_md.webp", thumb: "...abc123_thumb.webp" }
 */
export function getImagePaths(storedPath: string) {
  const ext = path.extname(storedPath);
  const base = storedPath.slice(0, storedPath.length - ext.length);
  return {
    large: storedPath,
    medium: `${base}_md${ext}`,
    thumb: `${base}_thumb${ext}`,
  };
}

/**
 * Get the best image path for a given context.
 * Falls back to the stored path if the specific size doesn't exist.
 */
export function getImageSrc(storedPath: string | null | undefined, size: "thumb" | "medium" | "large" = "large"): string {
  if (!storedPath) return "/placeholder.webp";

  // Legacy images (non-webp) — return as-is
  if (!storedPath.endsWith(".webp")) return storedPath;

  const paths = getImagePaths(storedPath);
  return paths[size];
}

// ─────────────────────────────────────────────
// Processing
// ─────────────────────────────────────────────

interface ProcessResult {
  /** Path stored in DB (large version), e.g. "/uploads/products/abc123.webp" */
  dbPath: string;
  /** Absolute path to large file on disk */
  largePath: string;
  /** Sizes in bytes */
  sizes: { large: number; medium: number; thumb: number };
}

/**
 * Process a single image: convert to WebP, generate 3 sizes.
 *
 * @param buffer   Raw image buffer (any format: JPEG, PNG, GIF, TIFF, HEIC, BMP, WebP)
 * @param destDir  Relative directory from project root (e.g. "public/uploads/products")
 * @param filename Base filename without extension (e.g. "1710000000_1")
 */
export async function processProductImage(
  buffer: Buffer,
  destDir: string,
  filename: string,
): Promise<ProcessResult> {
  const fullDir = path.join(process.cwd(), destDir);
  await mkdir(fullDir, { recursive: true });

  const webpName = `${filename}.webp`;
  const mdName = `${filename}_md.webp`;
  const thumbName = `${filename}_thumb.webp`;

  // Process all 3 sizes in parallel
  const [largeBuffer, mediumBuffer, thumbBuffer] = await Promise.all([
    sharp(buffer)
      .resize(SIZES.large.width, SIZES.large.height, { fit: "inside", withoutEnlargement: true })
      .webp({ quality: SIZES.large.quality })
      .toBuffer(),
    sharp(buffer)
      .resize(SIZES.medium.width, SIZES.medium.height, { fit: "inside", withoutEnlargement: true })
      .webp({ quality: SIZES.medium.quality })
      .toBuffer(),
    sharp(buffer)
      .resize(SIZES.thumb.width, SIZES.thumb.height, { fit: "inside", withoutEnlargement: true })
      .webp({ quality: SIZES.thumb.quality })
      .toBuffer(),
  ]);

  // Write all 3 files in parallel
  await Promise.all([
    writeFile(path.join(fullDir, webpName), largeBuffer),
    writeFile(path.join(fullDir, mdName), mediumBuffer),
    writeFile(path.join(fullDir, thumbName), thumbBuffer),
  ]);

  // Derive the public URL path (strip "public/" prefix if present)
  const publicPrefix = destDir.startsWith("public/") ? destDir.slice(7) : destDir;
  const dbPath = `/${publicPrefix}/${webpName}`;

  return {
    dbPath,
    largePath: path.join(fullDir, webpName),
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
