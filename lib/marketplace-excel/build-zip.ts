/**
 * Assemble the final ZIP that the admin downloads after a marketplace export.
 *
 * ZIP structure (tout à la racine, pas de sous-dossier marketplace) :
 *   <marketplace>.xlsx
 *   [<marketplace>_part-2-sur-N.xlsx ...]
 *   images/
 *     <file 1>.JPG
 *     <file 2>.JPG
 *     ...
 *
 * Pour Ankorstore : pas d'images, donc le ZIP n'est même pas construit (cf.
 * orchestrator qui retourne le buffer Excel direct).
 */

import JSZip from "jszip";
import type { PreparedImage } from "./prepare-images";

export interface ExcelFile {
  filename: string;
  buffer: Buffer;
}

export interface BuildZipInput {
  excelFiles: ExcelFile[];
  images?: PreparedImage[];
  /** Niveau de compression DEFLATE (0..9). 0 = aucune compression — utile
   * quand on emballe d'autres ZIP (compression supplémentaire inutile). */
  compressionLevel?: number;
}

/**
 * Assemble all files into a single ZIP buffer.
 */
export async function buildMarketplaceZip(input: BuildZipInput): Promise<Buffer> {
  const zip = new JSZip();

  for (const f of input.excelFiles) {
    zip.file(f.filename, f.buffer);
  }

  if (input.images && input.images.length > 0) {
    const imagesFolder = zip.folder("images");
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
    compressionOptions: { level: input.compressionLevel ?? 6 },
  });
}

