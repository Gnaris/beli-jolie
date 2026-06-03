/**
 * Top-level orchestrator for the marketplace Excel export.
 *
 * Loads products → validates eligibility → generates Excel(s) → prepares
 * images → assembles the final ZIP buffer. Returns both the ZIP and a list
 * of ignored products so the UI can show "X produits exportés, Y ignorés".
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

export interface MarketplaceExportPreview {
  marketplace: MarketplaceKey;
  marketplaceLabel: string;
  eligible: MarketplaceEligibility[];
  ignored: MarketplaceEligibility[];
}

export interface MarketplaceExportResult {
  marketplace: MarketplaceKey;
  marketplaceLabel: string;
  zip: Buffer;
  /** Suggested download filename, e.g. `paris-fashion-shop_2026-06-03.zip`. */
  zipFilename: string;
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

  // Generate Excel files
  let excelFiles: ExcelFile[] = [];
  let images: PreparedImage[] | undefined;

  switch (marketplace) {
    case "pfs":
      excelFiles = await generatePfsExcelFiles(eligibleProducts, ctx);
      images = await prepareImagesForPfs(eligibleProducts);
      break;
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

  const zip = await buildMarketplaceZip({
    marketplaceFolderName: FOLDER_NAMES[marketplace],
    excelFiles,
    images,
  });

  const today = new Date().toISOString().slice(0, 10);
  const zipFilename = `${FOLDER_NAMES[marketplace]}_${today}.zip`;

  return {
    marketplace,
    marketplaceLabel: LABELS[marketplace],
    zip,
    zipFilename,
    eligible: results.filter((r) => r.eligible),
    ignored: results.filter((r) => !r.eligible),
  };
}
