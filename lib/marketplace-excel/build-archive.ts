/**
 * Build a marketplace export ZIP archive:
 *   excel/pfs.xlsx
 *   excel/ankorstore.xlsx
 *   images_pfs.zip        (nested ZIP: "<reference> <couleur> <position>.jpg" at root — format PFS)
 *   AVERTISSEMENTS.txt    (warnings from both workbooks, if any)
 */

import JSZip from "jszip";
import sharp from "sharp";
import { logger } from "@/lib/logger";
import { readFile, keyFromDbPath } from "@/lib/storage";
import { buildPfsWorkbook } from "./pfs-export";
import { buildAnkorstoreWorkbook } from "./ankorstore-export";
import { loadExportContext, loadExportProducts } from "./load-products";
import { variantColorSlug, pfsImageFileName } from "./helpers";

export interface BuildArchiveOptions {
  productIds: string[];
  includePfs: boolean;
  includeAnkorstore: boolean;
}

/** Convert a WebP buffer to JPEG at maximum quality (no chroma subsampling, mozjpeg). */
async function webpToJpeg(buffer: Buffer): Promise<Buffer> {
  return await sharp(buffer)
    .jpeg({ quality: 100, chromaSubsampling: "4:4:4", mozjpeg: true })
    .toBuffer();
}

export async function buildMarketplaceArchive(opts: BuildArchiveOptions): Promise<{
  zipBuffer: Buffer;
  filename: string;
  warnings: { marketplace: string; reference: string; message: string }[];
  counts: { products: number; variants: number; images: number };
}> {
  if (!opts.includePfs && !opts.includeAnkorstore) {
    throw new Error("Aucun marketplace sélectionné");
  }

  const [ctx, products] = await Promise.all([
    loadExportContext(),
    loadExportProducts(opts.productIds),
  ]);

  if (products.length === 0) throw new Error("Aucun produit trouvé");

  const zip = new JSZip();
  const allWarnings: { marketplace: string; reference: string; message: string }[] = [];

  // Excel files
  if (opts.includePfs) {
    const { buffer, warnings } = await buildPfsWorkbook(products, ctx);
    zip.file("excel/pfs.xlsx", buffer);
    for (const w of warnings) allWarnings.push({ marketplace: "PFS", ...w });
  }
  if (opts.includeAnkorstore) {
    const { buffer, warnings } = await buildAnkorstoreWorkbook(products, ctx);
    zip.file("excel/ankorstore.xlsx", buffer);
    for (const w of warnings) allWarnings.push({ marketplace: "Ankorstore", ...w });
  }

  // ── Images (PFS only — Ankorstore embeds image URLs directly in its Excel) ─
  let variantCount = 0;
  let imageCount = 0;

  for (const p of products) {
    variantCount += p.variants.length;
  }

  if (opts.includePfs) {
    const imagesZip = new JSZip();
    const seenFilenames = new Set<string>();

    for (const p of products) {
      for (let vIdx = 0; vIdx < p.variants.length; vIdx++) {
        const v = p.variants[vIdx];
        const label = variantColorSlug(p, vIdx);

        for (let iIdx = 0; iIdx < v.imagePaths.length; iIdx++) {
          const dbPath = v.imagePaths[iIdx];
          let webpBuffer: Buffer;
          try {
            const key = keyFromDbPath(dbPath);
            webpBuffer = await readFile(key);
          } catch (err) {
            logger.warn("[marketplace-export] Image read failed", {
              reference: p.reference, path: dbPath, error: err instanceof Error ? err.message : String(err),
            });
            allWarnings.push({
              marketplace: "Images", reference: p.reference,
              message: `Image introuvable : ${dbPath}`,
            });
            continue;
          }

          let fname = pfsImageFileName(p.reference, label, iIdx);
          let counter = 1;
          while (seenFilenames.has(fname)) {
            fname = pfsImageFileName(p.reference, `${label} ${counter}`, iIdx);
            counter++;
          }
          seenFilenames.add(fname);

          try {
            const jpegBuffer = await webpToJpeg(webpBuffer);
            imagesZip.file(fname, jpegBuffer);
            imageCount++;
          } catch (err) {
            logger.warn("[marketplace-export] Image conversion failed", {
              reference: p.reference,
              error: err instanceof Error ? err.message : String(err),
            });
          }
        }
      }
    }

    if (imageCount > 0) {
      const imagesZipBuffer = await imagesZip.generateAsync({
        type: "nodebuffer",
        compression: "DEFLATE",
      });
      zip.file("images_pfs.zip", imagesZipBuffer);
    }
  }

  // Warnings file
  if (allWarnings.length > 0) {
    const lines = [
      "Avertissements export marketplace",
      `Date : ${new Date().toISOString()}`,
      "",
      ...allWarnings.map((w) => `[${w.marketplace}] ${w.reference} — ${w.message}`),
    ];
    zip.file("AVERTISSEMENTS.txt", lines.join("\n"));
  }

  const zipBuffer = await zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE" });

  const now = new Date();
  const ts = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, "0")}${String(now.getDate()).padStart(2, "0")}-${String(now.getHours()).padStart(2, "0")}${String(now.getMinutes()).padStart(2, "0")}`;
  const filename = `export-marketplace-${ts}.zip`;

  return {
    zipBuffer,
    filename,
    warnings: allWarnings,
    counts: { products: products.length, variants: variantCount, images: imageCount },
  };
}
