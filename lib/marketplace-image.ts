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
export const MIN_MARKETPLACE_HEIGHT = 500;

const WEBP_OPTS = { lossless: true, quality: 100, effort: 4 } as const;

const MARKETPLACE_IMAGE_PREFIX = "/api/marketplace-image";

/**
 * Construit l'URL publique à envoyer à une marketplace pour une image.
 * Le chemin BDD (`/uploads/produits/.../xxx.webp`) est passé en query
 * `?path=...` pour éviter tout problème d'encodage de segments contenant
 * des accents ou caractères spéciaux.
 *
 * Priorité de la base URL :
 *   1. `baseOverride` (paramètre)
 *   2. `MARKETPLACE_IMAGE_BASE_URL` (env var explicite, recommandé en dev
 *      pour pointer sur la prod — Faire/Ankorstore ne peuvent pas atteindre
 *      `localhost`)
 *   3. `NEXTAUTH_URL`
 *   4. `https://beliandjolie.com` (fallback prod)
 *
 * @param dbPath  Chemin tel que stocké en BDD (commence par "/uploads/").
 * @param baseOverride  Pour les tests : surcharge l'env.
 */
export function buildMarketplaceImageUrl(dbPath: string, baseOverride?: string): string {
  const base = (
    baseOverride ??
    process.env.MARKETPLACE_IMAGE_BASE_URL ??
    process.env.NEXTAUTH_URL ??
    "https://beliandjolie.com"
  ).replace(/\/$/, "");
  const normalized = dbPath.startsWith("/") ? dbPath : `/${dbPath}`;
  return `${base}${MARKETPLACE_IMAGE_PREFIX}?path=${encodeURIComponent(normalized)}`;
}

/**
 * Variante Faire : ajoute `?format=jpeg&minWidth=1000&minHeight=1000` à l'URL.
 * Le proxy convertira le WebP en JPEG et upscalera à au moins 1000 px sur
 * chaque côté (Faire refuse les images < 1000×1000 et les crop_fill en
 * panoramique).
 */
export function buildFaireImageUrl(dbPath: string, baseOverride?: string): string {
  const url = buildMarketplaceImageUrl(dbPath, baseOverride);
  const sep = url.includes("?") ? "&" : "?";
  return `${url}${sep}format=jpeg&minWidth=1000&minHeight=1000`;
}

/**
 * Variante Orderchamp : URL statique directe vers le fichier WebP dans
 * `public/uploads/…`. Le validateur d'images d'Orderchamp refuse
 * `Invalid attachment` sur les URLs de type `/api/marketplace-image?path=…`
 * (pas d'extension image dans le path, considéré comme une page web).
 *
 * Contrainte : le fichier stocké doit déjà respecter les dimensions
 * attendues (Orderchamp accepte WebP + accepte les images ≥ 500 px). Pas
 * d'upscale côté proxy — les tailles WebP standards de BJ (large ≥ 1024 px)
 * suffisent.
 *
 * Encodage strict : `encodeURI` laisse passer `!`, `'`, `(`, `)`, `*` — le
 * validateur d'Orderchamp rejette au moins les parenthèses (référence type
 * `a2251(2)` = doublon BJ). On encode chaque segment via `encodeURIComponent`
 * puis on ré-injecte les `/`, et on force le percent-encoding des sub-delims
 * restants pour éviter tout autre piège.
 */
export function buildOrderchampImageUrl(dbPath: string, baseOverride?: string): string {
  const base = (
    baseOverride ??
    process.env.MARKETPLACE_IMAGE_BASE_URL ??
    process.env.NEXTAUTH_URL ??
    "https://beliandjolie.com"
  ).replace(/\/$/, "");
  const normalized = dbPath.startsWith("/") ? dbPath : `/${dbPath}`;
  const encodedPath = normalized
    .split("/")
    .map((segment) =>
      encodeURIComponent(segment).replace(
        /[!'()*]/g,
        (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`,
      ),
    )
    .join("/");
  // Cache-buster obligatoire : Orderchamp dédupe silencieusement par URL
  // (même URL déjà vue → skip download, `images.edges` reste vide sans
  // erreur). Sans query différent à chaque envoi, un republish après
  // suppression du produit côté OC ne récupère jamais les images.
  const bust = `?v=${Date.now()}`;
  return `${base}${encodedPath}${bust}`;
}

/**
 * Convertit un buffer image en JPEG (qualité 90, progressive). Utilisé par le
 * proxy quand `?format=jpeg` est demandé — Faire et certains autres outils
 * refusent les WebP.
 */
export async function convertToJpeg(source: Buffer): Promise<Buffer> {
  return sharp(source)
    .jpeg({ quality: 90, progressive: true, mozjpeg: true })
    .toBuffer();
}

/**
 * Garantit que le buffer renvoyé a une largeur ≥ `minWidth` **ET** une
 * hauteur ≥ `minHeight`.
 *
 * - Si l'image source respecte déjà les deux seuils → renvoie le buffer
 *   d'origine tel quel (aucune re-encoding, donc aucune perte de qualité).
 * - Sinon → upscale en WebP lossless avec resize Lanczos3. Le facteur
 *   d'agrandissement est calculé pour que **la plus petite dimension**
 *   atteigne son seuil : `scale = max(minWidth / w, minHeight / h)`.
 *   Le ratio est préservé, donc l'autre dimension peut dépasser son seuil.
 *
 * Ankorstore refuse toute image dont la hauteur OU la largeur est < 500 px.
 * Auparavant, on n'assurait que la largeur → une image 800×339 passait le
 * proxy sans modif et Ankorstore la rejetait à la publication.
 *
 * @returns `{ buffer, resized }` — `resized: true` si on a ré-encodé.
 */
export async function ensureMinDimensions(
  source: Buffer,
  minWidth: number = MIN_MARKETPLACE_WIDTH,
  minHeight: number = MIN_MARKETPLACE_HEIGHT,
): Promise<{ buffer: Buffer; resized: boolean; width: number; height: number }> {
  const image = sharp(source);
  const meta = await image.metadata();
  const srcWidth = meta.width ?? 0;
  const srcHeight = meta.height ?? 0;

  if (srcWidth >= minWidth && srcHeight >= minHeight) {
    return { buffer: source, resized: false, width: srcWidth, height: srcHeight };
  }

  if (srcWidth === 0 || srcHeight === 0) {
    // Métadonnées illisibles : on renvoie l'original tel quel plutôt que
    // de risquer de corrompre l'image.
    return { buffer: source, resized: false, width: srcWidth, height: srcHeight };
  }

  // Facteur d'agrandissement uniforme : on prend le max entre
  // (minWidth / w) et (minHeight / h) pour que la plus petite dimension
  // atteigne exactement son seuil, l'autre dimension étant agrandie du
  // même facteur (ratio préservé).
  const scale = Math.max(minWidth / srcWidth, minHeight / srcHeight);
  const targetWidth = Math.max(minWidth, Math.round(srcWidth * scale));
  const targetHeight = Math.max(minHeight, Math.round(srcHeight * scale));

  const buffer = await sharp(source)
    .resize(targetWidth, targetHeight, { fit: "fill", kernel: sharp.kernel.lanczos3 })
    .webp(WEBP_OPTS)
    .toBuffer();

  return { buffer, resized: true, width: targetWidth, height: targetHeight };
}

/**
 * Alias historique — préservé pour la compatibilité des appels existants
 * qui ne se soucient que de la largeur (Faire ≥ 1000). Délègue à
 * `ensureMinDimensions` en désactivant le seuil de hauteur (0 = pas de
 * contrainte).
 */
export async function ensureMinWidth(
  source: Buffer,
  minWidth: number = MIN_MARKETPLACE_WIDTH,
): Promise<{ buffer: Buffer; resized: boolean; width: number; height: number }> {
  return ensureMinDimensions(source, minWidth, 0);
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
 * Stratégie « liste noire » : on autorise tout caractère que `slugify()`
 * (lib/storage.ts) laisse passer, et on refuse strictement ceux qu'elle
 * strippe (`\ : * ? " < > |`), plus le null byte, les caractères de
 * contrôle et le `%` (anti URL-encoding trompeur, déjà filtré en amont).
 * Alignement 1:1 avec `slugify()` : si un nom de couleur ou une référence
 * atterrit sur disque, il DOIT pouvoir être servi par ce proxy. Sinon
 * Ankorstore/PFS/eFashion voient 0 image et refusent la publication.
 *
 * Historique de bugs qui ont motivé cet élargissement :
 *  - 31/05 : « A11 Doré » → l'accent `é` rejeté par une regex ASCII →
 *    Ankorstore refusait la publication.
 *  - 06/06 : « G212(2) » (duplication de fiche) → parenthèses rejetées.
 *  - 31/07 : « Vert d'Eau » sur Issyma / 50322 → apostrophe rejetée →
 *    Ankorstore refusait avec « At least 1 image is required ».
 * Passage en liste noire pour éviter la boucle « nouveau caractère
 * autorisé par slugify → nouveau bug marketplace ».
 *
 * Règles finales :
 *  - commence par `/uploads/`
 *  - extension d'image classique (webp/jpg/jpeg/png/gif/avif)
 *  - aucun caractère filesystem-illégal : `\ : * ? " < > |` + ctrl + null
 *  - aucun `%` (redondant avec l'`includes("%")` en amont, garde-fou)
 *  - le `..` est bloqué par l'`includes("..")` en amont (le point seul
 *    reste nécessaire pour l'extension et les séparateurs).
 */
// eslint-disable-next-line no-control-regex
const SAFE_MARKETPLACE_PATH = /^\/uploads\/[^\\:*?"<>|\x00-\x1F%]+\.(webp|jpe?g|png|gif|avif)$/iu;

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
