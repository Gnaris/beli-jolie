/**
 * Client-safe image path utilities.
 * No Node.js dependencies (no sharp, fs, path).
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
