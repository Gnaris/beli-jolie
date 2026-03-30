/**
 * Client-safe image path utilities.
 * No Node.js dependencies (no sharp, fs, path).
 */

const R2_PUBLIC_URL = process.env.NEXT_PUBLIC_R2_URL || "";

/**
 * From a stored DB path (large), derive thumb and medium paths.
 * Input:  "/uploads/products/abc123.webp"
 * Output: { large: "...abc123.webp", medium: "...abc123_md.webp", thumb: "...abc123_thumb.webp" }
 */
export function getImagePaths(storedPath: string) {
  const lastDot = storedPath.lastIndexOf(".");
  if (lastDot === -1) return { large: storedPath, medium: storedPath, thumb: storedPath };
  const base = storedPath.slice(0, lastDot);
  const ext = storedPath.slice(lastDot);
  return {
    large: storedPath,
    medium: `${base}_md${ext}`,
    thumb: `${base}_thumb${ext}`,
  };
}

/**
 * Resolve a DB image path to its full public URL.
 * Use this to transform paths before sending to client components.
 * e.g. "/uploads/products/abc.webp" → "https://pub-xxx.r2.dev/uploads/products/abc.webp"
 */
export function resolveImageUrl(storedPath: string | null | undefined): string {
  if (!storedPath) return "/placeholder.webp";
  // Already a full URL (e.g. from PFS CDN)
  if (storedPath.startsWith("http")) return storedPath;
  if (R2_PUBLIC_URL) return `${R2_PUBLIC_URL}${storedPath}`;
  return storedPath;
}

/**
 * Get the best image URL for a given context.
 * Prepends the R2 public URL when available.
 */
export function getImageSrc(storedPath: string | null | undefined, size: "thumb" | "medium" | "large" = "large"): string {
  if (!storedPath) return "/placeholder.webp";

  // Already a full URL
  if (storedPath.startsWith("http")) return storedPath;

  // Legacy images (non-webp) — return as-is
  if (!storedPath.endsWith(".webp")) return storedPath;

  const paths = getImagePaths(storedPath);
  const relativePath = paths[size];

  // Prepend R2 public URL if available
  if (R2_PUBLIC_URL) {
    return `${R2_PUBLIC_URL}${relativePath}`;
  }

  return relativePath;
}
