/**
 * Assemble the final ZIP that the admin downloads after a marketplace export.
 *
 * Uses JSZip (already in the project) which loads everything in memory.
 * That's fine for the limits we set : 500 PFS products × ~5 images of ~200 KB
 * = ~500 MB worst case, well under Node's default heap.
 *
 * ZIP structure :
 *   <marketplace-folder>/
 *     <marketplace>.xlsx
 *     [<marketplace>_part-2-sur-N.xlsx ...]
 *     images/
 *       <file 1>.jpg
 *       <file 2>.jpg
 *       ...
 *
 * For Ankorstore (no images folder) :
 *   ankorstore/
 *     ankorstore.xlsx
 */

import JSZip from "jszip";
import type { PreparedImage } from "./prepare-images";

export interface ExcelFile {
  filename: string;
  buffer: Buffer;
}

export interface BuildZipInput {
  marketplaceFolderName: string; // ex: "paris-fashion-shop"
  excelFiles: ExcelFile[];
  images?: PreparedImage[];
}

/**
 * Assemble all files into a single ZIP buffer.
 */
export async function buildMarketplaceZip(input: BuildZipInput): Promise<Buffer> {
  const zip = new JSZip();
  const folder = zip.folder(input.marketplaceFolderName);
  if (!folder) {
    throw new Error("JSZip folder creation failed");
  }

  for (const f of input.excelFiles) {
    folder.file(f.filename, f.buffer);
  }

  if (input.images && input.images.length > 0) {
    const imagesFolder = folder.folder("images");
    if (!imagesFolder) {
      throw new Error("JSZip images folder creation failed");
    }
    for (const img of input.images) {
      const target = img.subfolder
        ? imagesFolder.folder(img.subfolder)
        : imagesFolder;
      if (!target) continue;
      target.file(img.filename, img.buffer);
    }
  }

  return zip.generateAsync({
    type: "nodebuffer",
    compression: "DEFLATE",
    compressionOptions: { level: 6 },
  });
}
