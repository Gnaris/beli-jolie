/**
 * Build a marketplace export ZIP archive:
 *   excel/pfs.xlsx
 *   excel/ankorstore.xlsx
 *   images/<reference>_<slug>_<index>.jpg  (WebP → JPEG, only when PFS included)
 *   AVERTISSEMENTS.txt   (warnings from both workbooks, if any)
 */

import JSZip from "jszip";
import sharp from "sharp";
import { logger } from "@/lib/logger";
import { downloadFromR2, r2KeyFromDbPath } from "@/lib/r2";
import { buildPfsWorkbook } from "./pfs-export";
import { buildAnkorstoreWorkbook } from "./ankorstore-export";
import { loadExportContext, loadExportProducts } from "./load-products";
import type { ExportProduct } from "./types";

export interface BuildArchiveOptions {
  productIds: string[];
  includePfs: boolean;
  includeAnkorstore: boolean;
}

function slug(input: string): string {
  return input
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 40) || "x";
}

function imageFileName(product: ExportProduct, variantIdx: number, variantLabel: string, imageIdx: number): string {
  return `${slug(product.reference)}_${slug(variantLabel || `v${variantIdx + 1}`)}_${imageIdx + 1}.jpg`;
}

function variantColorSlug(product: ExportProduct, idx: number): string {
  const v = product.variants[idx];
  if (!v) return `v${idx + 1}`;
  if (v.saleType === "UNIT") {
    return [...v.colorNames, ...v.subColorNames].join("_") || `v${idx + 1}`;
  }
  const first = v.packColorLines[0];
  return first ? first.colors.join("_") : `pack_${idx + 1}`;
}

async function webpBufferToJpeg(buffer: Buffer): Promise<Buffer> {
  return await sharp(buffer).jpeg({ quality: 90 }).toBuffer();
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

  // Images (only needed when PFS included — Ankorstore uses R2 URLs directly).
  // We still include them when only Ankorstore is selected, as a convenience backup.
  let variantCount = 0;
  let imageCount = 0;
  const seenFilenames = new Set<string>();

  for (const p of products) {
    for (let vIdx = 0; vIdx < p.variants.length; vIdx++) {
      const v = p.variants[vIdx];
      variantCount++;
      const label = variantColorSlug(p, vIdx);

      for (let iIdx = 0; iIdx < v.imagePaths.length; iIdx++) {
        const dbPath = v.imagePaths[iIdx];
        let fname = imageFileName(p, vIdx, label, iIdx);
        // Dedupe filename collisions
        let counter = 1;
        while (seenFilenames.has(fname)) {
          fname = imageFileName(p, vIdx, `${label}_${counter}`, iIdx);
          counter++;
        }
        seenFilenames.add(fname);

        try {
          const key = r2KeyFromDbPath(dbPath);
          const webpBuffer = await downloadFromR2(key);
          const jpegBuffer = await webpBufferToJpeg(webpBuffer);
          zip.file(`images/${fname}`, jpegBuffer);
          imageCount++;
        } catch (err) {
          logger.warn("[marketplace-export] Image download failed", {
            reference: p.reference, path: dbPath, error: err instanceof Error ? err.message : String(err),
          });
          allWarnings.push({
            marketplace: "Images", reference: p.reference,
            message: `Image introuvable sur R2 : ${dbPath}`,
          });
        }
      }
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
