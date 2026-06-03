/**
 * Image preparation per marketplace.
 *
 * Reads source images from `/public/uploads/produits/...` (WebP) and produces
 * the buffer + final filename for each marketplace's image folder inside the
 * ZIP. PFS and Microstore require JPG; Efashion accepts WebP but the official
 * script converts as JPG too — we standardize on JPG for these 3.
 *
 * Ankorstore is not handled here : its images are served via URL (not bundled).
 *
 * Naming rules :
 *  - PFS        : `<reference> <couleur> <pos>.jpg`  (cf. helpers.ts)
 *  - Efashion   : `<reference>-<couleur>-<pos>.jpg` (spaces -> hyphens)
 *  - Microstore : `<reference>_<couleur>_<pos>.jpg`
 */

import sharp from "sharp";
import { readFile, keyFromDbPath } from "@/lib/storage";
import type { ExportProduct } from "./types";
import { pfsImageFileName } from "./helpers";
import { slugForImageFilename } from "./format-helpers";

export interface PreparedImage {
  filename: string;
  subfolder?: string;
  buffer: Buffer;
}

async function convertToJpeg(source: Buffer, sourceExt: string): Promise<Buffer> {
  if (sourceExt === "jpg" || sourceExt === "jpeg") return source;
  return sharp(source).jpeg({ quality: 90 }).toBuffer();
}

function fileExt(path: string): string {
  const m = /\.([a-z0-9]+)$/i.exec(path);
  return (m?.[1] ?? "").toLowerCase();
}

export async function prepareImagesForPfs(
  products: ExportProduct[],
): Promise<PreparedImage[]> {
  const out: PreparedImage[] = [];
  for (const p of products) {
    for (let vIdx = 0; vIdx < p.variants.length; vIdx++) {
      const v = p.variants[vIdx]!;
      const variantLabel = v.colorNames.join(" ") || `v${vIdx + 1}`;
      for (let iIdx = 0; iIdx < v.imagePaths.length; iIdx++) {
        const path = v.imagePaths[iIdx]!;
        try {
          const ext = fileExt(path);
          const src = await readFile(keyFromDbPath(path));
          const buffer = await convertToJpeg(src, ext);
          const filename = pfsImageFileName(p.reference, variantLabel, iIdx);
          out.push({ filename, buffer });
        } catch {
          // missing file on disk : skip silently
        }
      }
    }
  }
  return out;
}

export async function prepareImagesForEfashion(
  products: ExportProduct[],
): Promise<PreparedImage[]> {
  const out: PreparedImage[] = [];
  // Images d'un produit, peu importe la variante source (UNIT ou PACK). Utilisé
  // en fallback quand la variante UNIT exportée n'a pas ses propres photos.
  function fallbackImages(p: ExportProduct): string[] {
    return p.variants.find((v) => v.imagePaths.length > 0)?.imagePaths ?? [];
  }
  for (const p of products) {
    // PACK exclus de l'export Efashion → seules les variantes UNIT sont nommées,
    // mais on emprunte les images du produit (souvent attachées aux PACK).
    const variants = p.variants.filter((v) => v.saleType === "UNIT");
    for (let vIdx = 0; vIdx < variants.length; vIdx++) {
      const v = variants[vIdx]!;
      const variantLabel = v.colorNames.join(" ") || `v${vIdx + 1}`;
      const imagePaths = v.imagePaths.length > 0 ? v.imagePaths : fallbackImages(p);
      for (let iIdx = 0; iIdx < imagePaths.length; iIdx++) {
        const path = imagePaths[iIdx]!;
        try {
          const ext = fileExt(path);
          const src = await readFile(keyFromDbPath(path));
          const buffer = await convertToJpeg(src, ext);
          const safeRef = slugForImageFilename(p.reference);
          const safeColor = slugForImageFilename(variantLabel);
          const filename = `${safeRef}-${safeColor}-${iIdx + 1}.jpg`;
          out.push({ filename, buffer });
        } catch {
          // skip missing files
        }
      }
    }
  }
  return out;
}

export async function prepareImagesForMicrostore(
  products: ExportProduct[],
): Promise<PreparedImage[]> {
  const out: PreparedImage[] = [];
  function fallbackImages(p: ExportProduct): string[] {
    return p.variants.find((v) => v.imagePaths.length > 0)?.imagePaths ?? [];
  }
  for (const p of products) {
    // PACK exclus de l'export Microstore → seules les variantes UNIT sont
    // nommées, mais on emprunte les images du produit (souvent attachées aux PACK).
    const variants = p.variants.filter((v) => v.saleType === "UNIT");
    for (let vIdx = 0; vIdx < variants.length; vIdx++) {
      const v = variants[vIdx]!;
      const variantLabel = v.colorNames.join(" ") || `v${vIdx + 1}`;
      const imagePaths = v.imagePaths.length > 0 ? v.imagePaths : fallbackImages(p);
      for (let iIdx = 0; iIdx < imagePaths.length; iIdx++) {
        const path = imagePaths[iIdx]!;
        try {
          const ext = fileExt(path);
          const src = await readFile(keyFromDbPath(path));
          const buffer = await convertToJpeg(src, ext);
          const safeRef = slugForImageFilename(p.reference);
          const safeColor = slugForImageFilename(variantLabel);
          const filename = `${safeRef}_${safeColor}_${iIdx + 1}.jpg`;
          out.push({ filename, buffer });
        } catch {
          // skip missing files
        }
      }
    }
  }
  return out;
}
