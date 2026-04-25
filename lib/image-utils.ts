/**
 * Client-safe image path utilities.
 * No Node.js dependencies (no sharp, fs, path).
 *
 * Images are stored locally under /public, so DB paths like
 * "/uploads/products/abc.webp" are already valid public URLs and need no prefix.
 */

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
 * Resolve a DB image path to its public URL.
 * Local paths are returned as-is; absolute http(s) URLs (e.g. PFS CDN) pass through.
 */
export function resolveImageUrl(storedPath: string | null | undefined): string {
  if (!storedPath) return "/placeholder.webp";
  if (storedPath.startsWith("http")) return storedPath;
  return storedPath;
}

/**
 * Get the best image URL for a given context (thumb / medium / large).
 */
export function getImageSrc(
  storedPath: string | null | undefined,
  size: "thumb" | "medium" | "large" = "large",
): string {
  if (!storedPath) return "/placeholder.webp";

  // Absolute URL (e.g. PFS CDN) — pass through
  if (storedPath.startsWith("http")) return storedPath;

  // Legacy non-webp images — return as-is (no md/thumb variants exist)
  if (!storedPath.endsWith(".webp")) return storedPath;

  return getImagePaths(storedPath)[size];
}
