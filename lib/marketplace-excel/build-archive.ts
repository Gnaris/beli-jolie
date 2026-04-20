/**
 * Build a marketplace export ZIP archive:
 *   excel/pfs.xlsx
 *   excel/ankorstore.xlsx
 *   {formatName}/<pattern>.<ext>   (one folder per configured image format)
 *   images/<reference>_<slug>_<index>.jpg  (fallback when no formats configured)
 *   AVERTISSEMENTS.txt   (warnings from both workbooks, if any)
 */

import JSZip from "jszip";
import sharp from "sharp";
import { logger } from "@/lib/logger";
import { downloadFromR2, r2KeyFromDbPath } from "@/lib/r2";
import { buildPfsWorkbook } from "./pfs-export";
import { buildAnkorstoreWorkbook } from "./ankorstore-export";
import { loadExportContext, loadExportProducts } from "./load-products";
import { prisma } from "@/lib/prisma";
import type { ExportProduct } from "./types";
import type { ImageExportFormat, ImageExportFormatPattern } from "@/app/actions/admin/site-config";

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
  return [...v.colorNames, ...v.subColorNames].join("_") || `v${idx + 1}`;
}

/** Build a filename from a pattern template */
function buildPatternFilename(
  pattern: ImageExportFormatPattern[],
  reference: string,
  colorLabel: string,
  imagePosition: number,
  extension: string,
): string {
  const parts = pattern.map((p) => {
    if (p.type === "text") return p.value;
    switch (p.value) {
      case "reference": return slug(reference);
      case "couleur": return slug(colorLabel);
      case "position": return String(imagePosition);
      default: return "";
    }
  });
  const name = parts.join("") || "image";
  return `${name}.${extension}`;
}

/** Convert a buffer to the target format at quality 100 with optional resize (cover crop) */
async function convertImage(
  buffer: Buffer,
  extension: string,
  width: number | null,
  height: number | null,
): Promise<Buffer> {
  let pipeline = sharp(buffer);

  // Resize with cover (crop center) if dimensions specified
  if (width && height) {
    pipeline = pipeline.resize(width, height, { fit: "cover", position: "centre" });
  }

  switch (extension) {
    case "png":
      return await pipeline.png({ quality: 100 }).toBuffer();
    case "webp":
      return await pipeline.webp({ quality: 100 }).toBuffer();
    case "jpg":
    default:
      return await pipeline.jpeg({ quality: 100 }).toBuffer();
  }
}

async function loadImageFormats(): Promise<ImageExportFormat[]> {
  const row = await prisma.siteConfig.findUnique({ where: { key: "image_export_formats" } });
  if (!row?.value) return [];
  try {
    return JSON.parse(row.value) as ImageExportFormat[];
  } catch {
    return [];
  }
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

  const [ctx, products, imageFormats] = await Promise.all([
    loadExportContext(),
    loadExportProducts(opts.productIds),
    loadImageFormats(),
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

  // ── Images ──────────────────────────────────────────────────────────────────
  let variantCount = 0;
  let imageCount = 0;

  // Download all images once (shared across formats)
  interface ImageEntry {
    product: ExportProduct;
    variantIdx: number;
    colorLabel: string;
    imageIdx: number;
    buffer: Buffer;
  }

  const imageEntries: ImageEntry[] = [];

  for (const p of products) {
    for (let vIdx = 0; vIdx < p.variants.length; vIdx++) {
      const v = p.variants[vIdx];
      variantCount++;
      const label = variantColorSlug(p, vIdx);

      for (let iIdx = 0; iIdx < v.imagePaths.length; iIdx++) {
        const dbPath = v.imagePaths[iIdx];
        try {
          const key = r2KeyFromDbPath(dbPath);
          const webpBuffer = await downloadFromR2(key);
          imageEntries.push({
            product: p,
            variantIdx: vIdx,
            colorLabel: label,
            imageIdx: iIdx,
            buffer: webpBuffer,
          });
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

  if (imageFormats.length > 0) {
    // Generate one folder per configured format
    for (const format of imageFormats) {
      const folderName = format.name.trim() || "images";
      const seenFilenames = new Set<string>();

      for (const entry of imageEntries) {
        let fname = buildPatternFilename(
          format.pattern,
          entry.product.reference,
          entry.colorLabel,
          entry.imageIdx + 1,
          format.extension,
        );

        // Dedupe collisions
        let counter = 1;
        const baseFname = fname;
        while (seenFilenames.has(fname)) {
          const dotIdx = baseFname.lastIndexOf(".");
          const namepart = baseFname.slice(0, dotIdx);
          const ext = baseFname.slice(dotIdx);
          fname = `${namepart}_${counter}${ext}`;
          counter++;
        }
        seenFilenames.add(fname);

        try {
          const converted = await convertImage(
            entry.buffer,
            format.extension,
            format.width,
            format.height,
          );
          zip.file(`${folderName}/${fname}`, converted);
          imageCount++;
        } catch (err) {
          logger.warn("[marketplace-export] Image conversion failed", {
            reference: entry.product.reference, format: format.name,
            error: err instanceof Error ? err.message : String(err),
          });
          allWarnings.push({
            marketplace: "Images", reference: entry.product.reference,
            message: `Erreur conversion image pour format "${format.name}"`,
          });
        }
      }
    }
  } else {
    // Fallback: legacy behavior (single images/ folder, JPEG quality 100)
    const seenFilenames = new Set<string>();

    for (const entry of imageEntries) {
      const label = entry.colorLabel;
      let fname = imageFileName(entry.product, entry.variantIdx, label, entry.imageIdx);
      let counter = 1;
      while (seenFilenames.has(fname)) {
        fname = imageFileName(entry.product, entry.variantIdx, `${label}_${counter}`, entry.imageIdx);
        counter++;
      }
      seenFilenames.add(fname);

      try {
        const jpegBuffer = await convertImage(entry.buffer, "jpg", null, null);
        zip.file(`images/${fname}`, jpegBuffer);
        imageCount++;
      } catch (err) {
        logger.warn("[marketplace-export] Image conversion failed", {
          reference: entry.product.reference,
          error: err instanceof Error ? err.message : String(err),
        });
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
