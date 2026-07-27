/**
 * Client-safe image path utilities.
 * No Node.js dependencies (no sharp, fs, path).
 *
 * Images are stored locally under /public, so DB paths like
 * "/uploads/products/abc.webp" are already valid public URLs and need no prefix.
 */

/**
 * From a stored DB path (large), derive thumb and medium paths.
 *
 * Convention actuelle (tiret) :
 *   "/uploads/produits/e310b/e310b-doré-1.webp"
 *   → medium "...e310b-doré-1-md.webp"
 *   → thumb  "...e310b-doré-1-thumb.webp"
 *
 * Rétro-compat (legacy underscore) :
 *   si le chemin stocké contient déjà `_md` ou `_thumb` dans son basename
 *   (ce qui ne devrait jamais arriver pour la "large", mais ça peut survenir
 *   si le chemin fourni est lui-même un md/thumb), on le retourne tel quel
 *   et on dérive les autres tailles avec le même séparateur.
 *
 * Toute nouvelle écriture utilise les tirets (`-md`, `-thumb`).
 */
export function getImagePaths(storedPath: string) {
  // URL dynamique du badge « Réf » : dérive md/thumb en swappant `size=`.
  if (storedPath.startsWith("/api/branded-image?")) {
    return {
      large:  storedPath.replace(/[?&]size=[a-z]+/i, (m) => (m[0] === "?" ? "?size=large" : "&size=large")),
      medium: storedPath.replace(/[?&]size=[a-z]+/i, (m) => (m[0] === "?" ? "?size=medium" : "&size=medium")),
      thumb:  storedPath.replace(/[?&]size=[a-z]+/i, (m) => (m[0] === "?" ? "?size=thumb" : "&size=thumb")),
    };
  }

  const lastDot = storedPath.lastIndexOf(".");
  if (lastDot === -1) {
    return { large: storedPath, medium: storedPath, thumb: storedPath };
  }
  const base = storedPath.slice(0, lastDot);
  const ext = storedPath.slice(lastDot);

  // If the path is already a medium/thumb variant, derive the others from
  // the same root using the same separator (covers both legacy `_` and new `-`).
  const variantMatch = base.match(/^(.+?)([-_])(md|thumb)$/);
  if (variantMatch) {
    const [, root, sep] = variantMatch;
    return {
      large:  `${root}${ext}`,
      medium: `${root}${sep}md${ext}`,
      thumb:  `${root}${sep}thumb${ext}`,
    };
  }

  // New paths: hyphen suffixes
  return {
    large:  storedPath,
    medium: `${base}-md${ext}`,
    thumb:  `${base}-thumb${ext}`,
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

  // Badge « Réf » dynamique — dérive md/thumb via getImagePaths.
  if (storedPath.startsWith("/api/branded-image?")) {
    return getImagePaths(storedPath)[size];
  }

  // Legacy non-webp images — return as-is (no md/thumb variants exist)
  if (!storedPath.endsWith(".webp")) return storedPath;

  return getImagePaths(storedPath)[size];
}
