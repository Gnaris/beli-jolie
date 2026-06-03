/**
 * Top-level orchestrator for the marketplace Excel export.
 *
 * Loads products → validates eligibility → generates Excel(s) → prepares
 * images → assembles the final ZIP buffer. Returns the file (Excel direct ou
 * ZIP) et la liste des produits ignorés pour que l'UI affiche le détail.
 *
 * Particularité PFS : le ZIP final contient un dossier `images/` à l'intérieur
 * duquel on trouve plusieurs sous-ZIP `images_part_<N>.zip`, chacun ≤ 15 Mo
 * (limite de taille des paquets accepté par PFS). Reproduit exactement le
 * comportement du script `processArchives` de la cliente.
 */

import type { MarketplaceKey, MarketplaceEligibility, ExportProduct } from "./types";
import { loadExportContext, loadExportProducts } from "./load-products";
import { validateProductsForMarketplace } from "./validate";
import { generatePfsExcelFiles } from "./generate-pfs";
import { generateEfashionExcelFiles } from "./generate-efashion";
import { generateMicrostoreExcelFiles } from "./generate-microstore";
import { generateAnkorstoreExcelFiles } from "./generate-ankorstore";
import {
  prepareImagesForPfs,
  prepareImagesForEfashion,
  prepareImagesForMicrostore,
} from "./prepare-images";
import { buildMarketplaceZip, type ExcelFile } from "./build-zip";
import type { PreparedImage } from "./prepare-images";
import JSZip from "jszip";

const FOLDER_NAMES: Record<MarketplaceKey, string> = {
  pfs: "paris-fashion-shop",
  efashion: "efashion",
  microstore: "microstore",
  ankorstore: "ankorstore",
};

const LABELS: Record<MarketplaceKey, string> = {
  pfs: "Paris Fashion Shop",
  efashion: "Efashion",
  microstore: "Microstore",
  ankorstore: "Ankorstore",
};

/** PFS impose 15 Mo max par paquet d'images uploadé. Le script de la cliente
 * utilise la même valeur. Les JPG ne se recompressent pas en DEFLATE, donc
 * la taille du sous-ZIP ≈ somme des tailles JPG brutes. */
const PFS_IMAGE_ZIP_MAX_BYTES = 15 * 1024 * 1024;

export interface MarketplaceExportPreview {
  marketplace: MarketplaceKey;
  marketplaceLabel: string;
  eligible: MarketplaceEligibility[];
  ignored: MarketplaceEligibility[];
}

export interface MarketplaceExportResult {
  marketplace: MarketplaceKey;
  marketplaceLabel: string;
  outputType: "xlsx" | "zip";
  fileBuffer: Buffer;
  filename: string;
  eligible: MarketplaceEligibility[];
  ignored: MarketplaceEligibility[];
}

/**
 * Run the validation phase only — no Excel generation, no ZIP. Used by the
 * preview modale ("X éligibles, Y ignorés, voulez-vous continuer ?").
 */
export async function previewMarketplaceExport(
  marketplace: MarketplaceKey,
  productIds: string[],
): Promise<MarketplaceExportPreview> {
  const products = await loadExportProducts(productIds);
  const results = validateProductsForMarketplace(products, marketplace);
  return {
    marketplace,
    marketplaceLabel: LABELS[marketplace],
    eligible: results.filter((r) => r.eligible),
    ignored: results.filter((r) => !r.eligible),
  };
}

/**
 * Run the full export : validate, generate Excel(s), prepare images, build ZIP.
 */
export async function runMarketplaceExport(
  marketplace: MarketplaceKey,
  productIds: string[],
): Promise<MarketplaceExportResult> {
  const [products, ctx] = await Promise.all([
    loadExportProducts(productIds),
    loadExportContext(),
  ]);

  const results = validateProductsForMarketplace(products, marketplace);
  const eligibleIds = new Set(results.filter((r) => r.eligible).map((r) => r.productId));
  const eligibleProducts: ExportProduct[] = products.filter((p) => eligibleIds.has(p.id));

  const today = new Date().toISOString().slice(0, 10);
  const baseName = FOLDER_NAMES[marketplace];
  const label = LABELS[marketplace];

  // ─── PFS : Excel + dossier images/ contenant des sous-ZIP de 15 Mo max ──
  if (marketplace === "pfs") {
    return await runPfsExport({
      products: eligibleProducts,
      ctx,
      baseName,
      label,
      today,
      results,
    });
  }

  // ─── Efashion / Microstore / Ankorstore : flux standard ─────────────────
  let excelFiles: ExcelFile[] = [];
  let images: PreparedImage[] | undefined;

  switch (marketplace) {
    case "efashion":
      excelFiles = await generateEfashionExcelFiles(eligibleProducts, ctx);
      images = await prepareImagesForEfashion(eligibleProducts);
      break;
    case "microstore":
      excelFiles = await generateMicrostoreExcelFiles(eligibleProducts, ctx);
      images = await prepareImagesForMicrostore(eligibleProducts);
      break;
    case "ankorstore":
      excelFiles = await generateAnkorstoreExcelFiles(eligibleProducts, ctx);
      images = undefined; // URLs only, no bundled images
      break;
  }

  const noImages = !images || images.length === 0;
  if (excelFiles.length === 1 && noImages) {
    const onlyExcel = excelFiles[0]!;
    return {
      marketplace,
      marketplaceLabel: label,
      outputType: "xlsx",
      fileBuffer: onlyExcel.buffer,
      filename: `${baseName}_${today}.xlsx`,
      eligible: results.filter((r) => r.eligible),
      ignored: results.filter((r) => !r.eligible),
    };
  }

  const zip = await buildMarketplaceZip({ excelFiles, images });

  return {
    marketplace,
    marketplaceLabel: label,
    outputType: "zip",
    fileBuffer: zip,
    filename: `${baseName}_${today}.zip`,
    eligible: results.filter((r) => r.eligible),
    ignored: results.filter((r) => !r.eligible),
  };
}

// ─── PFS-specific export ────────────────────────────────────────────────────

interface PfsExportArgs {
  products: ExportProduct[];
  ctx: Awaited<ReturnType<typeof loadExportContext>>;
  baseName: string;
  label: string;
  today: string;
  results: MarketplaceEligibility[];
}

interface PfsImagePart {
  /** Nom du sous-ZIP, ex : `images_part_1.zip`. */
  filename: string;
  /** Buffer du sous-ZIP. */
  buffer: Buffer;
}

/**
 * Regroupe les images PFS en plusieurs sous-ZIP de 15 Mo max.
 * Algo identique au script `processArchives` de la cliente :
 *   - parcourt les images dans l'ordre
 *   - cumule la taille brute en cours
 *   - quand l'ajout d'une image ferait dépasser 15 Mo, ferme le sous-ZIP en
 *     cours et en démarre un nouveau
 *
 * Pas de découpage par produit ici : les images sont regroupées par taille
 * uniquement. PFS ré-associe ses images à ses produits via le nom de fichier
 * (`<ref> <couleur> <pos>.JPG`) une fois uploadées.
 */
async function bundlePfsImagesIntoParts(
  images: PreparedImage[],
  maxBytes: number = PFS_IMAGE_ZIP_MAX_BYTES,
): Promise<PfsImagePart[]> {
  if (images.length === 0) return [];

  const batches: PreparedImage[][] = [[]];
  let currentBytes = 0;

  for (const img of images) {
    const size = img.buffer.length;
    if (
      currentBytes + size > maxBytes &&
      batches[batches.length - 1]!.length > 0
    ) {
      batches.push([]);
      currentBytes = 0;
    }
    batches[batches.length - 1]!.push(img);
    currentBytes += size;
  }

  const parts: PfsImagePart[] = [];
  for (let i = 0; i < batches.length; i++) {
    const batch = batches[i]!;
    if (batch.length === 0) continue;

    const subZip = new JSZip();
    for (const img of batch) {
      // STORE = pas de compression DEFLATE supplémentaire. Les JPG sont déjà
      // compressés, recompresser ne gagne rien et fait perdre du CPU.
      subZip.file(img.filename, img.buffer, { compression: "STORE" });
    }
    const buffer = await subZip.generateAsync({
      type: "nodebuffer",
      compression: "STORE",
    });
    parts.push({ filename: `images_part_${i + 1}.zip`, buffer });
  }

  return parts;
}

/**
 * Assemble le ZIP final PFS :
 *   {
 *     paris-fashion-shop.xlsx
 *     [paris-fashion-shop_part-2-sur-N.xlsx ...]
 *     images/
 *       images_part_1.zip   (≤ 15 Mo)
 *       images_part_2.zip   (≤ 15 Mo)
 *       ...
 *   }
 */
async function runPfsExport(args: PfsExportArgs): Promise<MarketplaceExportResult> {
  const { products, ctx, baseName, label, today, results } = args;

  const [excelFiles, allImages] = await Promise.all([
    generatePfsExcelFiles(products, ctx),
    prepareImagesForPfs(products),
  ]);

  const imageParts = await bundlePfsImagesIntoParts(allImages);

  const zip = new JSZip();

  // Excel(s) à la racine.
  for (const f of excelFiles) {
    zip.file(f.filename, f.buffer);
  }

  // Sous-ZIP images dans `images/`, déjà non compressés (STORE).
  if (imageParts.length > 0) {
    const imagesFolder = zip.folder("images");
    if (!imagesFolder) {
      throw new Error("JSZip: failed to create images/ folder");
    }
    for (const part of imageParts) {
      imagesFolder.file(part.filename, part.buffer, { compression: "STORE" });
    }
  }

  const buffer = await zip.generateAsync({
    type: "nodebuffer",
    compression: "DEFLATE",
    compressionOptions: { level: 6 },
  });

  return {
    marketplace: "pfs",
    marketplaceLabel: label,
    outputType: "zip",
    fileBuffer: buffer,
    filename: `${baseName}_${today}.zip`,
    eligible: results.filter((r) => r.eligible),
    ignored: results.filter((r) => !r.eligible),
  };
}

/** Exposé pour les tests unitaires (regroupement par taille). */
export { bundlePfsImagesIntoParts };
