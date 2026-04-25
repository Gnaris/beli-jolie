/**
 * Local file storage.
 *
 * Files live under <project>/public/<key>. Next.js serves /public statically,
 * so a key like "uploads/products/abc.webp" is reachable at "/uploads/products/abc.webp".
 */

import { promises as fs } from "node:fs";
import path from "node:path";

// ─────────────────────────────────────────────
// Storage root
// ─────────────────────────────────────────────

const STORAGE_ROOT = path.resolve(process.cwd(), "public");

/**
 * Resolve a storage key to an absolute filesystem path, refusing any key
 * that would escape the storage root.
 */
function resolveKey(key: string): string {
  const normalized = key.replace(/^[/\\]+/, "");
  const abs = path.resolve(STORAGE_ROOT, normalized);
  const rel = path.relative(STORAGE_ROOT, abs);
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
        const rel = path.relative(STORAGE_ROOT, full).split(path.sep).join("/");
        out.push(rel);
      }
    }
  }

  await walk(root);
  return out;
}
