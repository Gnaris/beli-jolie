/**
 * Marketplace image proxy.
 *
 * Certaines marketplaces (Ankorstore notamment) refusent les images dont
 * la largeur est inférieure à 500px. Plutôt que de modifier les fichiers
 * stockés localement (qui servent aussi le site public), on les proxifie
 * via `/api/marketplace-image/...` :
 *  - Si l'image source fait ≥ MIN_MARKETPLACE_WIDTH → renvoyée telle quelle.
 *  - Sinon → upscalée en WebP lossless via sharp (Lanczos3) à au moins
 *    MIN_MARKETPLACE_WIDTH de large, ratio préservé.
 *
 * Le fichier d'origine sur disque n'est jamais modifié.
 */

import sharp from "sharp";

export const MIN_MARKETPLACE_WIDTH = 500;

const WEBP_OPTS = { lossless: true, quality: 100, effort: 4 } as const;

const MARKETPLACE_IMAGE_PREFIX = "/api/marketplace-image";

/**
 * Construit l'URL publique à envoyer à une marketplace pour une image.
 * Le chemin BDD (`/uploads/produits/.../xxx.webp`) est passé en query
 * `?path=...` pour éviter tout problème d'encodage de segments contenant
 * des accents ou caractères spéciaux.
 *
 * @param dbPath  Chemin tel que stocké en BDD (commence par "/uploads/").
 * @param baseOverride  Pour les tests : surcharge `NEXTAUTH_URL`.
 */
export function buildMarketplaceImageUrl(dbPath: string, baseOverride?: string): string {
  const base = (baseOverride ?? process.env.NEXTAUTH_URL ?? "https://beliandjolie.com").replace(/\/$/, "");
  const normalized = dbPath.startsWith("/") ? dbPath : `/${dbPath}`;
  return `${base}${MARKETPLACE_IMAGE_PREFIX}?path=${encodeURIComponent(normalized)}`;
}

/**
 * Garantit que le buffer renvoyé a une largeur ≥ `minWidth`.
 *
 * - Si l'image source est déjà assez large → renvoie le buffer d'origine
 *   tel quel (aucune re-encoding, donc aucune perte de qualité, et le
 *   Content-Type initial reste valide).
 * - Sinon → upscale en WebP lossless avec resize Lanczos3 (sharp default)
 *   à exactement `minWidth` de large, hauteur calculée proportionnellement.
 *   La hauteur originale est multipliée par le même facteur d'agrandissement.
 *
 * @returns `{ buffer, resized }` — `resized: true` si on a ré-encodé.
 */
export async function ensureMinWidth(
  source: Buffer,
  minWidth: number = MIN_MARKETPLACE_WIDTH,
): Promise<{ buffer: Buffer; resized: boolean; width: number; height: number }> {
  const image = sharp(source);
  const meta = await image.metadata();
  const srcWidth = meta.width ?? 0;
  const srcHeight = meta.height ?? 0;

  if (srcWidth >= minWidth) {
    return { buffer: source, resized: false, width: srcWidth, height: srcHeight };
  }

  if (srcWidth === 0 || srcHeight === 0) {
    // Métadonnées illisibles : on renvoie l'original tel quel plutôt que
    // de risquer de corrompre l'image.
    return { buffer: source, resized: false, width: srcWidth, height: srcHeight };
  }

  // Largeur cible = minWidth, hauteur calculée pour préserver le ratio.
  const scale = minWidth / srcWidth;
  const targetHeight = Math.round(srcHeight * scale);

  const buffer = await sharp(source)
    .resize(minWidth, targetHeight, { fit: "fill", kernel: sharp.kernel.lanczos3 })
    .webp(WEBP_OPTS)
    .toBuffer();

  return { buffer, resized: true, width: minWidth, height: targetHeight };
}

/**
 * Validation stricte du chemin demandé sur /api/marketplace-image.
 *
 * Refuse tout chemin qui pourrait sortir du dossier `public/uploads`
 * (path traversal vers `private/uploads` : factures, KBIS, etc.).
 * `resolveKey` côté storage rejette déjà ces chemins en levant une
 * exception, mais on coupe ici en amont avec une 400 explicite plutôt
 * que de s'appuyer sur le 404 fallback du try/catch.
 *
 * Règles :
 *  - commence par `/uploads/`
 *  - extension d'image classique (webp/jpg/jpeg/png/gif/avif)
 *  - aucun `..`, antislash, null byte ou caractère `%` (anti-encodage trompeur)
 *  - lettres Unicode (\p{L}), chiffres (\p{N}), point, tiret, underscore, slash
 *  - parenthèses `(` `)` (suffixe de duplication, ex. G212 → G212(2))
 *
 * Pourquoi les lettres Unicode : `slugify()` côté storage conserve les
 * accents (a11-doré-1.webp). Si on limitait à l'ASCII, le proxy renverrait
 * une 400 sur toutes les images dont le nom de couleur contient un accent,
 * et Ankorstore ignorerait silencieusement ces variantes (bug constaté sur
 * A11 / Doré le 31/05).
 *
 * Pourquoi les parenthèses : la duplication d'un produit ajoute `(n)` à la
 * référence. `slugify()` ne les retire pas, donc le dossier devient
 * `uploads/produits/g212(2)/` et toutes les images d'une fiche dupliquée
 * étaient rejetées par ce proxy → Ankorstore voyait 0 image et refusait la
 * publication (bug constaté sur G212(2) le 06/06).
 */
const SAFE_MARKETPLACE_PATH = /^\/uploads\/[\p{L}\p{N}._()\-/]+\.(webp|jpe?g|png|gif|avif)$/iu;

export function isSafeMarketplaceImagePath(rawPath: string | null): rawPath is string {
  if (!rawPath) return false;
  if (rawPath.includes("..")) return false;
  if (rawPath.includes("\\")) return false;
  if (rawPath.includes("\0")) return false;
  if (rawPath.includes("%")) return false;
  return SAFE_MARKETPLACE_PATH.test(rawPath);
}

/**
 * Devine le Content-Type à partir de l'extension du chemin.
 * Utilisé pour servir le buffer original sans le re-encoder quand
 * l'image est déjà assez large.
 */
export function guessContentType(path: string): string {
  const lower = path.toLowerCase();
  if (lower.endsWith(".webp")) return "image/webp";
  if (lower.endsWith(".png")) return "image/png";
  if (lower.endsWith(".gif")) return "image/gif";
  if (lower.endsWith(".jpg") || lower.endsWith(".jpeg")) return "image/jpeg";
  return "application/octet-stream";
}
