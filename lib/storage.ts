/**
 * Local file storage.
 *
 * Files live under <project>/public/<key>. Next.js serves /public statically,
 * so a key like "uploads/produits/REF/REF-couleur-1.webp" is reachable at
 * "/uploads/produits/REF/REF-couleur-1.webp".
 *
 * For private files (kbis, factures, réclamations, pièces-jointes-email)
 * the key is prefixed with "private/" and resolved against <project>/private.
 */

import { promises as fs } from "node:fs";
import path from "node:path";

// ─────────────────────────────────────────────
// Storage root
// ─────────────────────────────────────────────

/**
 * Roots are resolved lazily so tests that `process.chdir` into a tmp
 * directory still see the right paths.
 */
function publicRoot(): string {
  return path.resolve(process.cwd(), "public");
}
function privateRoot(): string {
  return path.resolve(process.cwd(), "private");
}

/**
 * Resolve a storage key to an absolute filesystem path, refusing any key
 * that would escape the storage root.
 *
 * Keys starting with "private/" are resolved against <project>/private,
 * everything else under <project>/public.
 *
 * Note multi-tenant : les callers passent explicitement un path déjà scopé
 * (via `withTenantSlug` ou les helpers `xxxDir(ref, tenantSlug)`).
 * `resolveKey` ne cherche pas à deviner la boutique — il fait juste la
 * conversion clé → path absolu, en sécurisant contre les échappements.
 */
function resolveKey(key: string): string {
  const normalized = key.replace(/^[/\\]+/, "");
  const isPrivate = normalized.startsWith("private/");
  const root = isPrivate ? privateRoot() : publicRoot();
  const relativeKey = isPrivate ? normalized.slice("private/".length) : normalized;
  const abs = path.resolve(root, relativeKey);
  const rel = path.relative(root, abs);
  if (rel.startsWith("..") || path.isAbsolute(rel)) {
    throw new Error(`Refusing key outside storage root: ${key}`);
  }
  return abs;
}

// ─────────────────────────────────────────────
// Public URL helper
// ─────────────────────────────────────────────

/**
 * Build the public URL for a storage key.
 * Files are served by Next.js from /public, so the URL is just `/<key>`.
 */
export function getPublicUrl(key: string): string {
  const clean = key.replace(/^[/\\]+/, "");
  return `/${clean}`;
}

/**
 * Convert a DB path ("/uploads/products/abc.webp") to a storage key
 * ("uploads/products/abc.webp"). Strips the leading slash.
 */
export function keyFromDbPath(dbPath: string): string {
  return dbPath.replace(/^\//, "");
}

/**
 * Convert a destDir like "public/uploads/products" to a key prefix
 * ("uploads/products"). Strips the leading "public/".
 */
export function keyPrefixFromDestDir(destDir: string): string {
  return destDir.replace(/^public\//, "");
}

// ─────────────────────────────────────────────
// Upload
// ─────────────────────────────────────────────

export async function uploadFile(
  key: string,
  buffer: Buffer,
  _contentType: string = "image/webp",
): Promise<void> {
  const abs = resolveKey(key);
  await fs.mkdir(path.dirname(abs), { recursive: true });
  await fs.writeFile(abs, buffer);
}

// ─────────────────────────────────────────────
// Read
// ─────────────────────────────────────────────

export async function readFile(key: string): Promise<Buffer> {
  return fs.readFile(resolveKey(key));
}

// ─────────────────────────────────────────────
// Delete
// ─────────────────────────────────────────────

export async function deleteFile(key: string): Promise<void> {
  try {
    await fs.unlink(resolveKey(key));
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return;
    throw err;
  }
}

export async function deleteFiles(keys: string[]): Promise<void> {
  if (keys.length === 0) return;
  await Promise.all(keys.map((k) => deleteFile(k)));
}

// ─────────────────────────────────────────────
// Existence check (throws if missing)
// ─────────────────────────────────────────────

export async function assertFileExists(key: string): Promise<void> {
  await fs.stat(resolveKey(key));
}

/**
 * Return `{ mtime, size }` for a file, or `null` if it does not exist.
 * Used by caches that need to compare freshness without throwing on a miss.
 */
export async function statFile(
  key: string,
): Promise<{ mtime: Date; size: number } | null> {
  try {
    const s = await fs.stat(resolveKey(key));
    return { mtime: s.mtime, size: s.size };
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw err;
  }
}

// ─────────────────────────────────────────────
// Copy / move
// ─────────────────────────────────────────────

export async function copyFile(sourceKey: string, destKey: string): Promise<void> {
  const src = resolveKey(sourceKey);
  const dst = resolveKey(destKey);
  await fs.mkdir(path.dirname(dst), { recursive: true });
  await fs.copyFile(src, dst);
}

export async function moveFile(sourceKey: string, destKey: string): Promise<void> {
  const src = resolveKey(sourceKey);
  const dst = resolveKey(destKey);
  await fs.mkdir(path.dirname(dst), { recursive: true });
  try {
    await fs.rename(src, dst);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== "EXDEV") throw err;
    await fs.copyFile(src, dst);
    await fs.unlink(src);
  }
}

// ─────────────────────────────────────────────
// List (recursive)
// ─────────────────────────────────────────────

export async function listFiles(prefix: string): Promise<string[]> {
  const cleanPrefix = prefix.replace(/^[/\\]+/, "");
  const root = resolveKey(cleanPrefix);
  const isPrivate = cleanPrefix.startsWith("private/");
  const baseRoot = isPrivate ? privateRoot() : publicRoot();
  const keyPrefix = isPrivate ? "private/" : "";

  let stat: Awaited<ReturnType<typeof fs.stat>>;
  try {
    stat = await fs.stat(root);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw err;
  }

  if (stat.isFile()) return [cleanPrefix];

  const out: string[] = [];

  async function walk(dirAbs: string): Promise<void> {
    const entries = await fs.readdir(dirAbs, { withFileTypes: true });
    for (const entry of entries) {
      const full = path.join(dirAbs, entry.name);
      if (entry.isDirectory()) {
        await walk(full);
      } else if (entry.isFile()) {
        const rel = path.relative(baseRoot, full).split(path.sep).join("/");
        out.push(`${keyPrefix}${rel}`);
      }
    }
  }

  await walk(root);
  return out;
}

// ─────────────────────────────────────────────
// Slugification (filesystem-safe)
// ─────────────────────────────────────────────

/**
 * Make a filesystem-friendly slug.
 *
 * - lowercases
 * - keeps accents (Linux/Windows both support UTF-8 filenames)
 * - replaces whitespace with "-"
 * - strips characters that are unsafe on Windows / SSHFS / shells
 *   (\, /, :, *, ?, ", <, >, |) plus null bytes and ASCII control chars
 * - collapses runs of "-" and trims leading/trailing "-" and "."
 * - returns "sans-nom" if everything is stripped
 */
export function slugify(input: string): string {
  if (input == null) return "sans-nom";
  const stripped = String(input)
    // Décompose les caractères accentués en base + diacritique (NFD) puis
    // retire les diacritiques (`é` → `e`, `à` → `a`, `ç` → `c`…). Sans
    // ça, les URLs marketplaces contiennent `%C3%A9` (`é` encodé) qui
    // fait échouer Orderchamp avec « Invalid attachment » (validateur
    // strict qui refuse les percent-encoded chars non-ASCII).
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .trim()
    // Strip filesystem-illegal characters and ASCII control chars / null bytes.
    // eslint-disable-next-line no-control-regex
    .replace(/[\\/:*?"<>|\x00-\x1F]/g, "")
    // Références type `A2251(2)` (doublon) : transforme `(N)` en `_N` pour
    // éviter les parenthèses dans les URLs marketplaces (Orderchamp rejette
    // « Invalid attachment » sur les parenthèses non-encodées).
    .replace(/\((\d+)\)/g, "_$1")
    // Parenthèses orphelines restantes → `_` (filet de sécurité).
    .replace(/[()]/g, "_")
    // Whitespace -> "-"
    .replace(/\s+/g, "-")
    // Collapse repeated "-"
    .replace(/-+/g, "-")
    // Trim "-" and "." at the edges (Windows hates trailing ".")
    .replace(/^[-.]+|[-.]+$/g, "");
  return stripped || "sans-nom";
}

// ─────────────────────────────────────────────
// Multi-tenant path prefixing
// ─────────────────────────────────────────────

/**
 * Injecte un slug de boutique dans une clé de storage :
 *   "uploads/produits/e807"          → "uploads/{slug}/produits/e807"
 *   "private/uploads/kbis/abc"       → "private/uploads/{slug}/kbis/abc"
 *   "/uploads/collections/hero.webp" → "/uploads/{slug}/collections/hero.webp"
 *
 * Si la clé porte déjà un slug de boutique connu (auto-détection via prefixe),
 * on ne double pas le préfixe. Utile pour rester idempotent pendant la
 * migration progressive des paths.
 */
export function withTenantSlug(key: string, tenantSlug: string): string {
  if (!tenantSlug) return key;
  const leading = key.startsWith("/") ? "/" : "";
  const clean = key.replace(/^[/\\]+/, "");
  if (clean.startsWith(`uploads/${tenantSlug}/`)) return key;
  if (clean.startsWith(`private/uploads/${tenantSlug}/`)) return key;

  if (clean.startsWith("private/uploads/")) {
    return `${leading}private/uploads/${tenantSlug}/${clean.slice("private/uploads/".length)}`;
  }
  if (clean.startsWith("uploads/")) {
    return `${leading}uploads/${tenantSlug}/${clean.slice("uploads/".length)}`;
  }
  return key;
}

// ─────────────────────────────────────────────
// Storage path helpers (new arborescence — see CLAUDE.md)
// ─────────────────────────────────────────────

/**
 * Directory key for a product's images.
 * `productImageDir("E310B")` → `"uploads/produits/e310b"`.
 *
 * Multi-tenant : passe le tenant slug en 2ᵉ argument pour obtenir la version
 * scopée (`uploads/beliandjolie/produits/e310b`). Sans slug, retourne le path
 * legacy (utilisé pendant la migration progressive).
 */
export function productImageDir(reference: string, tenantSlug?: string): string {
  const base = `uploads/produits/${slugify(reference)}`;
  return tenantSlug ? withTenantSlug(base, tenantSlug) : base;
}

/**
 * Base filename (no extension) for a product image.
 * - With color: `"{ref}-{couleur}-{n}"`
 * - Without color: `"{ref}-{n}"`
 *
 * `colorName` may be a single name ("Doré") or a multi-color label
 * (e.g. "Doré + Argenté") — both pass through `slugify`.
 */
export function productImageBaseName(
  reference: string,
  colorName: string | null | undefined,
  index: number,
): string {
  const ref = slugify(reference);
  const safeIndex = Number.isFinite(index) && index > 0 ? Math.floor(index) : 1;
  if (colorName && String(colorName).trim()) {
    return `${ref}-${slugify(colorName)}-${safeIndex}`;
  }
  return `${ref}-${safeIndex}`;
}

/** Directory key for a collection's cover images. */
export function collectionImageDir(slug: string, tenantSlug?: string): string {
  const base = `uploads/collections/${slugify(slug)}`;
  return tenantSlug ? withTenantSlug(base, tenantSlug) : base;
}

/**
 * Directory key for a category's round illustration (home + /categories).
 * `categoryImageDir("clx…")` → `"uploads/categories/clx…"`.
 * Une catégorie n'a qu'une image, `id` sert de sous-dossier stable (pas le
 * slug, qui bouge lors des renommages).
 */
export function categoryImageDir(id: string, tenantSlug?: string): string {
  const base = `uploads/categories/${slugify(id)}`;
  return tenantSlug ? withTenantSlug(base, tenantSlug) : base;
}

/** Directory key for the homepage banner. */
export function bannerDir(tenantSlug?: string): string {
  return tenantSlug ? withTenantSlug("uploads/banniere", tenantSlug) : "uploads/banniere";
}

/** Directory key for the site favicon (browser tab icon, Google results). */
export function faviconDir(tenantSlug?: string): string {
  return tenantSlug ? withTenantSlug("uploads/favicon", tenantSlug) : "uploads/favicon";
}

/**
 * Directory key for the brand logo (JSON-LD Organization, Open Graph fallback).
 * Distinct from the favicon : le logo est un carré 512×512 haute qualité pour
 * Google + réseaux sociaux, alors que le favicon est optimisé pour 32×32.
 */
export function brandLogoDir(tenantSlug?: string): string {
  return tenantSlug ? withTenantSlug("uploads/logo", tenantSlug) : "uploads/logo";
}

/** Directory key for the shared mail header logo (marketing mails). */
export function mailBrandingDir(tenantSlug?: string): string {
  return tenantSlug ? withTenantSlug("uploads/mail-branding", tenantSlug) : "uploads/mail-branding";
}

/** Directory key for the 6 photos of the /a-propos public page. */
export function aboutPhotoDir(tenantSlug?: string): string {
  return tenantSlug ? withTenantSlug("uploads/a-propos", tenantSlug) : "uploads/a-propos";
}

/** Directory key for color pattern images. */
export function colorPatternDir(tenantSlug?: string): string {
  return tenantSlug ? withTenantSlug("uploads/motifs-couleurs", tenantSlug) : "uploads/motifs-couleurs";
}

/** Directory key for chat attachments (lives under uploads/temp). */
export function chatAttachmentDir(tenantSlug?: string): string {
  const base = "uploads/temp/chat";
  return tenantSlug ? withTenantSlug(base, tenantSlug) : base;
}

/** Directory key for a client's bordereaux (public, lien direct). */
export function bordereauDir(clientId: string, tenantSlug?: string): string {
  const base = `uploads/bordereaux/${slugify(clientId)}`;
  return tenantSlug ? withTenantSlug(base, tenantSlug) : base;
}

/** Directory key for a client's KBIS uploads (private). */
export function kbisDir(clientId: string, tenantSlug?: string): string {
  const base = `private/uploads/kbis/${slugify(clientId)}`;
  return tenantSlug ? withTenantSlug(base, tenantSlug) : base;
}

/** Directory key for a client's complementary documents (private). */
export function clientDocumentsDir(clientId: string, tenantSlug?: string): string {
  const base = `private/uploads/documents/${slugify(clientId)}`;
  return tenantSlug ? withTenantSlug(base, tenantSlug) : base;
}

/** Directory key for invoices (private), grouped by year. */
export function invoiceDir(year: number, tenantSlug?: string): string {
  const base = `private/uploads/factures/${year}`;
  return tenantSlug ? withTenantSlug(base, tenantSlug) : base;
}

/**
 * Directory key for claim attachments (public — servies via `<img src>`),
 * une sous-arbo par commande.
 *
 * NB : la spec mentionne `private/uploads/reclamations/` mais l'UI affiche
 * actuellement ces photos par URL directe. Les déplacer sous `private/`
 * casserait `<img>` côté admin/client. On garde donc `public/uploads/reclamations/`
 * et on note la déviation dans la doc.
 */
export function claimDir(orderRef: string, tenantSlug?: string): string {
  const base = `uploads/reclamations/commande-${slugify(orderRef)}`;
  return tenantSlug ? withTenantSlug(base, tenantSlug) : base;
}

/** Directory key for credit notes (private). */
export function creditNoteDir(tenantSlug?: string): string {
  return tenantSlug ? withTenantSlug("private/uploads/avoirs", tenantSlug) : "private/uploads/avoirs";
}

/** Directory key for email attachments (private), grouped by year-month. */
export function emailAttachmentDir(yearMonth: string, tenantSlug?: string): string {
  const base = `private/uploads/pieces-jointes-email/${slugify(yearMonth)}`;
  return tenantSlug ? withTenantSlug(base, tenantSlug) : base;
}

// ─────────────────────────────────────────────
// Folder rename helpers
// ─────────────────────────────────────────────

/**
 * Rename a directory (move it from `oldKey` to `newKey`). No-op if
 * `oldKey === newKey` or the source directory does not exist.
 *
 * Returns `true` if a rename actually happened, `false` otherwise.
 */
async function renameDirectory(oldKey: string, newKey: string): Promise<boolean> {
  if (oldKey === newKey) return false;
  const srcAbs = resolveKey(oldKey);
  const dstAbs = resolveKey(newKey);

  try {
    await fs.stat(srcAbs);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return false;
    throw err;
  }

  await fs.mkdir(path.dirname(dstAbs), { recursive: true });
  await fs.rename(srcAbs, dstAbs);
  return true;
}

/**
 * Rename every file inside `dirKey` whose basename starts with `oldPrefix`,
 * replacing the prefix with `newPrefix`. Sub-directories are walked
 * recursively.
 *
 * Returns the list of `{ oldName, newName, parentKey }` for each renamed file.
 */
async function renameFilesPrefixedIn(
  dirKey: string,
  oldPrefix: string,
  newPrefix: string,
): Promise<{ oldName: string; newName: string; parentKey: string }[]> {
  if (oldPrefix === newPrefix) return [];

  const dirAbs = resolveKey(dirKey);
  const renamed: { oldName: string; newName: string; parentKey: string }[] = [];

  async function walk(currentAbs: string, currentKey: string): Promise<void> {
    let entries: import("node:fs").Dirent[];
    try {
      entries = await fs.readdir(currentAbs, { withFileTypes: true });
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") return;
      throw err;
    }
    for (const entry of entries) {
      const fullAbs = path.join(currentAbs, entry.name);
      const fullKey = `${currentKey}/${entry.name}`;
      if (entry.isDirectory()) {
        await walk(fullAbs, fullKey);
        continue;
      }
      if (!entry.isFile()) continue;
      if (!entry.name.startsWith(oldPrefix)) continue;
      const newName = newPrefix + entry.name.slice(oldPrefix.length);
      const newAbs = path.join(currentAbs, newName);
      await fs.rename(fullAbs, newAbs);
      renamed.push({ oldName: entry.name, newName, parentKey: currentKey });
    }
  }

  await walk(dirAbs, dirKey);
  return renamed;
}

/**
 * Rename a product folder and all the files inside it (whose basenames
 * begin with the slugified old reference) so they reflect the new
 * reference. Returns the list of DB-path swaps the caller must apply to
 * `ProductColorImage.path` rows in the same transaction.
 *
 * No-op if the folder does not exist (product without uploaded images).
 */
export async function renameProductFolder(
  oldRef: string,
  newRef: string,
  tenantSlug?: string,
): Promise<{ renamed: { oldDbPath: string; newDbPath: string }[] }> {
  const oldSlug = slugify(oldRef);
  const newSlug = slugify(newRef);
  if (oldSlug === newSlug) return { renamed: [] };

  const legacyOld = `uploads/produits/${oldSlug}`;
  const legacyNew = `uploads/produits/${newSlug}`;
  const oldDir = tenantSlug ? withTenantSlug(legacyOld, tenantSlug) : legacyOld;
  const newDir = tenantSlug ? withTenantSlug(legacyNew, tenantSlug) : legacyNew;

  const moved = await renameDirectory(oldDir, newDir);
  if (!moved) return { renamed: [] };

  // After the rename the files still carry the *old* prefix; rename them so
  // the new reference is reflected in their basenames too.
  const renamed = await renameFilesPrefixedIn(newDir, `${oldSlug}-`, `${newSlug}-`);

  return {
    renamed: renamed.map(({ oldName, newName }) => ({
      oldDbPath: `/${oldDir}/${oldName}`,
      newDbPath: `/${newDir}/${newName}`,
    })),
  };
}

/**
 * Substitue textuellement l'ancien slug produit par le nouveau dans un
 * chemin BDD ou un destDir de job image. Gère à la fois le nom de dossier
 * et le préfixe du basename fichier.
 *
 * Utilisé pour rattraper les paths qui ont été posés APRÈS un renameProductFolder :
 *  - `ProductColorImage.path` créé par le worker image en vol
 *  - `ImageProcessingJob.destDir/filename/dbPath` d'un job encore PENDING/PROCESSING
 *
 * Retourne le path inchangé si l'ancien slug n'y apparaît pas.
 *
 * @example
 * substituteReferenceInPath(
 *   "/uploads/tid/produits/a2251_2/a2251_2-doré-1-abc.webp",
 *   "a2251_2",
 *   "a2251_3",
 *   "tid",
 * ) === "/uploads/tid/produits/a2251_3/a2251_3-doré-1-abc.webp"
 */
export function substituteReferenceInPath(
  originalPath: string,
  oldSlug: string,
  newSlug: string,
  tenantSlug: string,
): string {
  if (oldSlug === newSlug) return originalPath;
  const oldFolder = `/uploads/${tenantSlug}/produits/${oldSlug}/`;
  const newFolder = `/uploads/${tenantSlug}/produits/${newSlug}/`;
  if (!originalPath.includes(oldFolder)) return originalPath;
  const afterFolder = originalPath.replace(oldFolder, newFolder);
  // Remplace aussi le préfixe basename `{oldSlug}-` juste après le dossier.
  const filePrefixIdx = afterFolder.indexOf(newFolder) + newFolder.length;
  const rest = afterFolder.slice(filePrefixIdx);
  if (rest.startsWith(`${oldSlug}-`)) {
    return afterFolder.slice(0, filePrefixIdx) + newSlug + "-" + rest.slice(oldSlug.length + 1);
  }
  return afterFolder;
}

/**
 * Variante pour un `ImageProcessingJob.destDir` (pas de leading `/`, pas
 * de basename fichier). Ex : `uploads/tid/produits/a2251_2` → `uploads/tid/produits/a2251_3`.
 */
export function substituteReferenceInDestDir(
  destDir: string,
  oldSlug: string,
  newSlug: string,
): string {
  if (oldSlug === newSlug) return destDir;
  const marker = `/produits/${oldSlug}`;
  const idx = destDir.indexOf(marker);
  if (idx < 0) return destDir;
  const afterMarker = destDir.slice(idx + marker.length);
  // Vérifie que ce qui suit est soit "/" soit rien (frontière).
  if (afterMarker !== "" && !afterMarker.startsWith("/")) return destDir;
  return destDir.slice(0, idx) + `/produits/${newSlug}` + afterMarker;
}

/**
 * Same idea for collection folders. Returns DB-path swaps for the
 * `Collection.image` field.
 */
export async function renameCollectionFolder(
  oldSlug: string,
  newSlug: string,
  tenantSlug?: string,
): Promise<{ renamed: { oldDbPath: string; newDbPath: string }[] }> {
  const o = slugify(oldSlug);
  const n = slugify(newSlug);
  if (o === n) return { renamed: [] };

  const legacyOld = `uploads/collections/${o}`;
  const legacyNew = `uploads/collections/${n}`;
  const oldDir = tenantSlug ? withTenantSlug(legacyOld, tenantSlug) : legacyOld;
  const newDir = tenantSlug ? withTenantSlug(legacyNew, tenantSlug) : legacyNew;

  const moved = await renameDirectory(oldDir, newDir);
  if (!moved) return { renamed: [] };

  const renamed = await renameFilesPrefixedIn(newDir, `${o}-`, `${n}-`);
  return {
    renamed: renamed.map(({ oldName, newName }) => ({
      oldDbPath: `/${oldDir}/${oldName}`,
      newDbPath: `/${newDir}/${newName}`,
    })),
  };
}

// ─────────────────────────────────────────────
// Recursive directory delete
// ─────────────────────────────────────────────

/**
 * Recursively delete a directory (storage equivalent of `rm -rf dirKey`).
 * No-op if it does not exist.
 */
export async function deleteDirectory(dirKey: string): Promise<void> {
  const abs = resolveKey(dirKey);
  try {
    await fs.rm(abs, { recursive: true, force: true });
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return;
    throw err;
  }
}
