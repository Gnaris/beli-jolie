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

import type {
  MarketplaceKey,
  MarketplaceEligibility,
  ExportProduct,
  ExportMode,
} from "./types";
import { loadExportContext, loadExportProducts } from "./load-products";
import { validateProductsForMarketplace } from "./validate";
import { generatePfsExcelFiles } from "./generate-pfs";
import { generateEfashionExcelFiles } from "./generate-efashion";
import { generateMicrostoreExcelFiles } from "./generate-microstore";
import { generateAnkorstoreExcelFiles } from "./generate-ankorstore";
import { generateFaireExcelFiles } from "./generate-faire";
import { enrichProductsWithPfsTranslations } from "./enrich-translations-pfs";
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
  faire: "faire",
};

const LABELS: Record<MarketplaceKey, string> = {
  pfs: "Paris Fashion Shop",
  efashion: "Efashion",
  microstore: "Microstore",
  ankorstore: "Ankorstore",
  faire: "Faire",
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
 *
 * `mode` détermine ce qui est inclus :
 *  - "both"        : Excel + images (défaut)
 *  - "excel-only"  : Excel sans images — dossier `images/` absent
 *  - "images-only" : ZIP contenant uniquement le dossier `images/`
 *
 * Ankorstore + "images-only" : combinaison non autorisée (les images
 * Ankorstore sont consommées via URL, jamais bundlées).
 */
export async function runMarketplaceExport(
  marketplace: MarketplaceKey,
  productIds: string[],
  mode: ExportMode = "both",
): Promise<MarketplaceExportResult> {
  if (marketplace === "ankorstore" && mode === "images-only") {
    throw new Error(
      "Ankorstore ne supporte pas l'export d'images seules : les images sont récupérées via les URLs du site.",
    );
  }
  if (marketplace === "faire" && mode === "images-only") {
    throw new Error(
      "Faire ne supporte pas l'export d'images seules : les images sont récupérées via les URLs du site.",
    );
  }

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
      mode,
    });
  }

  // ─── Efashion / Microstore / Ankorstore : flux standard ─────────────────
  const includeExcel = mode !== "images-only";
  const includeImages = mode !== "excel-only";

  let excelFiles: ExcelFile[] = [];
  let images: PreparedImage[] | undefined;

  switch (marketplace) {
    case "efashion":
      if (includeExcel) excelFiles = await generateEfashionExcelFiles(eligibleProducts, ctx);
      if (includeImages) images = await prepareImagesForEfashion(eligibleProducts);
      break;
    case "microstore":
      if (includeExcel) excelFiles = await generateMicrostoreExcelFiles(eligibleProducts, ctx);
      if (includeImages) images = await prepareImagesForMicrostore(eligibleProducts);
      break;
    case "ankorstore":
      // `images-only` est déjà refusé en début de fonction. Reste : both/excel-only,
      // tous deux n'incluent jamais d'images (URLs only).
      excelFiles = await generateAnkorstoreExcelFiles(eligibleProducts, ctx);
      images = undefined;
      break;
    case "faire":
      // Idem Ankorstore : Faire récupère les images via les URLs publiques
      // pointées par la colonne `product_images` (cf. generate-faire.ts).
      // `images-only` déjà refusé en début de fonction.
      excelFiles = await generateFaireExcelFiles(eligibleProducts, ctx);
      images = undefined;
      break;
  }

  const noImages = !images || images.length === 0;

  // Excel direct si pas d'images ET un seul fichier Excel (cas usuel
  // efashion/microstore/ankorstore en mode excel-only ou both sans images).
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
  const suffix = mode === "images-only" ? "_images" : mode === "excel-only" ? "_excel" : "";

  return {
    marketplace,
    marketplaceLabel: label,
    outputType: "zip",
    fileBuffer: zip,
    filename: `${baseName}${suffix}_${today}.zip`,
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
  mode: ExportMode;
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
  const { products, ctx, baseName, label, today, results, mode } = args;
  const includeExcel = mode !== "images-only";
  const includeImages = mode !== "excel-only";

  // Enrichit les produits avec les traductions EN/ES/DE/IT à la volée — pas
  // d'écriture en base, c'est uniquement en mémoire pour cet export. Le site
  // reste FR + EN. L'API PFS renvoie toutes les langues en 1 seul appel par
  // texte. Cf. lib/marketplace-excel/enrich-translations-pfs.ts.
  //
  // En mode images-only on n'a besoin d'aucune traduction (les images sont
  // nommées d'après la référence locale, indépendantes de la langue).
  const translatedProducts = includeExcel
    ? await enrichProductsWithPfsTranslations(products)
    : products;

  const [excelFiles, allImages] = await Promise.all([
    includeExcel ? generatePfsExcelFiles(translatedProducts, ctx) : Promise.resolve([] as ExcelFile[]),
    includeImages ? prepareImagesForPfs(translatedProducts) : Promise.resolve([] as PreparedImage[]),
  ]);

  const imageParts = includeImages ? await bundlePfsImagesIntoParts(allImages) : [];

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

  const suffix = mode === "images-only" ? "_images" : mode === "excel-only" ? "_excel" : "";

  return {
    marketplace: "pfs",
    marketplaceLabel: label,
    outputType: "zip",
    fileBuffer: buffer,
    filename: `${baseName}${suffix}_${today}.zip`,
    eligible: results.filter((r) => r.eligible),
    ignored: results.filter((r) => !r.eligible),
  };
}

/** Exposé pour les tests unitaires (regroupement par taille). */
export { bundlePfsImagesIntoParts };
