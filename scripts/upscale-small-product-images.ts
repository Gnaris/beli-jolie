/**
 * Parcourt public/uploads/produits et agrandit toutes les images "large"
 * (sans suffixe -md / -thumb) dont la largeur ou la hauteur est < 500px.
 *
 * Cible : la version "large" de chaque photo produit (celle dont l'URL est
 * envoyée à Ankorstore). Ankorstore exige minimum 500px ; on monte à 600px
 * pour avoir une marge.
 *
 * Les versions -md / -thumb ne sont jamais exposées à l'extérieur, on les
 * laisse intactes.
 *
 * Usage :
 *   npx tsx scripts/upscale-small-product-images.ts            # applique
 *   npx tsx scripts/upscale-small-product-images.ts --dry-run  # simulation
 */

import { promises as fs } from "fs";
import path from "path";
import sharp from "sharp";
import { MIN_LARGE_WIDTH } from "@/lib/image-processor";

const ROOT = path.resolve(process.cwd(), "public/uploads/produits");
const TRIGGER_BELOW = 500; // seuil de déclenchement (image plus petite que ça → upscale)

const WEBP_OPTS = { lossless: true, quality: 100, effort: 4 } as const;

async function* walk(dir: string): AsyncGenerator<string> {
  let entries: import("fs").Dirent[];
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const e of entries) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) yield* walk(full);
    else if (e.isFile() && e.name.endsWith(".webp")) yield full;
  }
}

function isLargeFile(filePath: string): boolean {
  const base = path.basename(filePath);
  // skip variants -md / -thumb (et anciens _md / _thumb)
  return !(
    base.endsWith("-md.webp") ||
    base.endsWith("-thumb.webp") ||
    base.endsWith("_md.webp") ||
    base.endsWith("_thumb.webp")
  );
}

async function main() {
  const dryRun = process.argv.includes("--dry-run");
  let scanned = 0;
  let candidates = 0;
  let upscaled = 0;
  let failed = 0;
  const failures: { file: string; error: string }[] = [];

  console.log(
    `Racine : ${ROOT}\nSeuil  : largeur ou hauteur < ${TRIGGER_BELOW}px → upscale a ${MIN_LARGE_WIDTH}px\nMode   : ${dryRun ? "DRY-RUN" : "APPLY"}\n`,
  );

  for await (const file of walk(ROOT)) {
    if (!isLargeFile(file)) continue;
    scanned++;

    try {
      const meta = await sharp(file).metadata();
      const w = meta.width ?? 0;
      const h = meta.height ?? 0;
      if (w === 0 || h === 0) continue;
      if (Math.min(w, h) >= TRIGGER_BELOW) continue;

      candidates++;
      const rel = path.relative(ROOT, file);
      console.log(`  [${candidates}] ${rel}  (${w}x${h})  →  ${MIN_LARGE_WIDTH}px`);

      if (!dryRun) {
        const buf = await sharp(file)
          .resize(MIN_LARGE_WIDTH, MIN_LARGE_WIDTH, { fit: "inside", withoutEnlargement: false })
          .webp(WEBP_OPTS)
          .toBuffer();
        await fs.writeFile(file, buf);
      }
      upscaled++;
    } catch (err) {
      failed++;
      const msg = err instanceof Error ? err.message : String(err);
      failures.push({ file, error: msg });
      console.error(`  ECHEC ${file} : ${msg}`);
    }
  }

  console.log(
    `\n--- Resume ---\n` +
      `Scannes   : ${scanned}\n` +
      `Candidats : ${candidates}\n` +
      `Reecrits  : ${dryRun ? 0 : upscaled}${dryRun ? "  (dry-run)" : ""}\n` +
      `Echecs    : ${failed}`,
  );

  if (failures.length > 0) {
    console.log("\nDetail des echecs :");
    for (const f of failures.slice(0, 20)) {
      console.log(`  - ${f.file} : ${f.error}`);
    }
    if (failures.length > 20) console.log(`  ... +${failures.length - 20} autres`);
  }
}

main().catch((err) => {
  console.error("Echec du script :", err);
  process.exit(1);
});
