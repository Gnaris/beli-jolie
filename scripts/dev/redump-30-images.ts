/**
 * REDUMP-30-IMAGES
 *
 * A executer SUR LE VPS. Prend la liste des references en argument, applique
 * `slugify(reference)` (comme productImageDir), et tar les VRAIS dossiers.
 *
 * Correctif du bug de dump-30-products.ts qui utilisait `slice(0, 5)`.
 *
 * Usage :
 *   npx tsx scripts/dev/redump-30-images.ts A2162E A1794E ...
 */
import { promises as fs } from "node:fs";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const runFile = promisify(execFile);

const OUT_TAR = "/tmp/dump-30-products-images-v2.tar.gz";
const PROJECT_ROOT = "/var/www/beliandjolie";

// Meme regle que lib/storage.ts slugify (approximatif : lowercase + strip diacritics + [^a-z0-9-])
function slugify(input: string): string {
  return String(input)
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

async function main() {
  const refs = process.argv.slice(2);
  if (refs.length === 0) {
    console.error("Usage: redump-30-images.ts REF1 REF2 ...");
    process.exit(1);
  }

  const dirs = Array.from(new Set(refs.map((r) => `public/uploads/beliandjolie/produits/${slugify(r)}`)));

  console.log(`[redump] Refs: ${refs.length}, dossiers uniques: ${dirs.length}`);
  for (const d of dirs) console.log(`  - ${d}`);

  const argv = ["-czf", OUT_TAR, "-C", PROJECT_ROOT, "--ignore-failed-read", ...dirs];
  await runFile("tar", argv);

  const stat = await fs.stat(OUT_TAR);
  console.log(`[redump] Tar ecrit: ${OUT_TAR} (${(stat.size / 1024 / 1024).toFixed(1)} Mo)`);
}

main().catch((err) => {
  console.error("[redump] ERREUR", err);
  process.exit(1);
});
