/**
 * Image preparation per marketplace.
 *
 * Reads source images from `/public/uploads/produits/...` (WebP) and produces
 * the buffer + final filename for each marketplace's image folder inside the
 * ZIP. PFS / Efashion / Microstore require JPG with the exact naming
 * conventions documented in `helpers.ts`.
 *
 * Ankorstore n'est pas géré ici : ses images partent en URL dans l'Excel.
 *
 * Pour les PACK (et Efashion / Microstore qui ne les exportent pas), on saute
 * les variantes PACK. Pour les UNIT sans image propre, on retombe sur la
 * première variante du produit qui en a (les images vivent au niveau couleur,
 * partagées entre UNIT et PACK de la même couleur).
 */

import sharp from "sharp";
import { readFile, keyFromDbPath } from "@/lib/storage";
import type { ExportProduct } from "./types";
import {
  pfsImageFileName,
  efashionImageFileName,
  microstoreImageFileName,
} from "./helpers";

export interface PreparedImage {
  filename: string;
  subfolder?: string;
  buffer: Buffer;
  /** ID du produit auquel cette image appartient — utilisé par PFS pour
   * regrouper les images d'un même produit dans la même tranche ZIP. */
  productId?: string;
}

async function convertToJpeg(source: Buffer, sourceExt: string): Promise<Buffer> {
  if (sourceExt === "jpg" || sourceExt === "jpeg") return source;
  return sharp(source).jpeg({ quality: 90 }).toBuffer();
}

function fileExt(path: string): string {
  const m = /\.([a-z0-9]+)$/i.exec(path);
  return (m?.[1] ?? "").toLowerCase();
}

/** Images du produit, peu importe la variante source — fallback quand la
 * variante UNIT exportée n'a pas ses propres photos. */
function fallbackImages(p: ExportProduct): string[] {
  return p.variants.find((v) => v.imagePaths.length > 0)?.imagePaths ?? [];
}

export async function prepareImagesForPfs(
  products: ExportProduct[],
): Promise<PreparedImage[]> {
  const out: PreparedImage[] = [];
  for (const p of products) {
    for (let vIdx = 0; vIdx < p.variants.length; vIdx++) {
      const v = p.variants[vIdx]!;
      const variantLabel = v.colorNames.join(" ") || `v${vIdx + 1}`;
      const imagePaths = v.imagePaths.length > 0 ? v.imagePaths : fallbackImages(p);
      for (let iIdx = 0; iIdx < imagePaths.length; iIdx++) {
        const path = imagePaths[iIdx]!;
        try {
          const ext = fileExt(path);
          const src = await readFile(keyFromDbPath(path));
          const buffer = await convertToJpeg(src, ext);
          const filename = pfsImageFileName(p.reference, variantLabel, iIdx);
          out.push({ filename, buffer, productId: p.id });
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
          const filename = efashionImageFileName(p.reference, variantLabel, iIdx);
          out.push({ filename, buffer, productId: p.id });
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
          const filename = microstoreImageFileName(p.reference, variantLabel, iIdx);
          out.push({ filename, buffer, productId: p.id });
        } catch {
          // skip missing files
        }
      }
    }
  }
  return out;
}
