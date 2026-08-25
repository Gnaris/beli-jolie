/**
 * Microstore — envoi de photos (cœur métier, sans requireAdmin).
 *
 * Ces fonctions dupliquent la logique historiquement présente dans
 * `app/actions/admin/microstore-picture-station.ts`, mais sans l'appel à
 * `requireAdmin()` en tête. Elles sont conçues pour être appelées :
 *   - depuis les server actions du même fichier, qui font `requireAdmin` en
 *     amont puis délèguent au core ;
 *   - depuis les fire-and-forget déclenchés après un push produit
 *     (`pushProductToMicrostore`, `bulkPushProductsToMicrostore`) ;
 *   - depuis le worker de queue `runMicrostoreJob` qui tourne hors requête HTTP.
 *
 * Pourquoi cette extraction : jusqu'au 2026-08-25, le fire-and-forget dans
 * `microstore-products.ts` appelait la server action `sendProductPhotosToMicrostore`
 * après la réponse HTTP renvoyée. `requireAdmin()` échouait alors silencieusement
 * (getServerSession n'a plus de cookies HTTP hors requête), aucun
 * MicrostoreUploadJob n'était créé, et le widget « Photos Microstore » restait
 * vide. Bug reporté par la cliente le 2026-08-25.
 */

import { logger } from "@/lib/logger";
import {
  getStoredPictureStation,
  getMicrostorePictureStationCompany,
  uploadImageToMicrostoreOss,
  getMicrostoreGoodsByItemRef,
  patchMicrostoreGoodsImages,
  bulkImportMicrostorePictures,
  type MicrostoreBulkPictureEntry,
} from "@/lib/microstore-picture-station";
import {
  createMicrostoreUploadJob,
  markMicrostoreUploadJobStarted,
  bumpMicrostoreUploadJobCounters,
  markMicrostoreUploadJobStatus,
} from "@/lib/microstore-upload-jobs";
import { assertMicrostorePushAllowed } from "@/lib/microstore-preflight";

export interface SendProductPhotosResult {
  success: boolean;
  error?: string;
  reference?: string;
  microstoreGoodsId?: number;
  microstoreGoodsName?: string;
  companyName?: string;
  /** Détail par couleur BJ, pour l'UI. */
  colors?: Array<{
    colorName: string;
    /** null si la couleur BJ n'a pas de correspondant côté Microstore. */
    matchedMicrostoreColor: string | null;
    matchedSkuIds: number[];
    uploadedUrls: string[];
    imagesLocal: string[];
    error?: string;
  }>;
}

export interface BulkSendPhotosResult {
  success: boolean;
  error?: string;
  attempted: number;
  photosUploaded: number;
  successCount: number;
  failedCount: number;
  skippedProducts: string[];
  coversPatched: number;
  coversFailed: number;
}

/**
 * Prépare un buffer image prêt à être uploadé vers Microstore :
 *  1. Applique le badge référence si `brandedReference` est fourni
 *  2. Ré-encode systématiquement en JPEG (Microstore attend du JPEG dans les
 *     HAR de production ; envoyer du WebP dans un `.JPG` fait échouer
 *     silencieusement le badge)
 */
async function prepareMicrostoreJpeg(
  sourceBuffer: Buffer,
  brandedReference?: string,
): Promise<Buffer> {
  let buffer: Buffer = sourceBuffer;
  if (brandedReference) {
    try {
      const { composeBrandedBuffer } = await import("@/lib/branded-image");
      buffer = await composeBrandedBuffer({
        sourceBuffer,
        reference: brandedReference,
        size: "large",
      });
    } catch (err) {
      logger.warn("[Microstore/PS] badge branding failed, falling back to source", {
        error: err,
        reference: brandedReference,
      });
    }
  }
  const sharp = (await import("sharp")).default;
  return sharp(buffer)
    .rotate()
    .jpeg({ quality: 92, chromaSubsampling: "4:4:4", mozjpeg: true })
    .toBuffer();
}

/**
 * Envoi photos d'un seul produit — cœur métier sans requireAdmin.
 * Voir la server action `sendProductPhotosToMicrostore` pour l'API publique.
 */
export async function sendProductPhotosToMicrostoreCore(
  reference: string,
): Promise<SendProductPhotosResult> {
  const trimmedRef = (reference || "").trim();
  if (!trimmedRef) {
    return { success: false, error: "Référence produit manquante." };
  }

  const preflight = await assertMicrostorePushAllowed();
  if (!preflight.ok) return { success: false, error: preflight.error };

  const stored = await getStoredPictureStation();
  if (!stored) {
    return { success: false, error: "Aucun lien de station de transfert configuré." };
  }

  const { prisma } = await import("@/lib/prisma");
  const [product, brandedBadgeRow] = await Promise.all([
    prisma.product.findFirst({
      where: { reference: trimmedRef },
      select: {
        id: true,
        reference: true,
        name: true,
        primaryColorId: true,
        colors: {
          where: { saleType: "UNIT" },
          select: {
            id: true,
            isPrimary: true,
            color: { select: { id: true, name: true } },
          },
        },
        colorImages: {
          orderBy: { order: "asc" },
          select: { path: true, order: true, colorId: true },
        },
      },
    }),
    prisma.siteConfig.findFirst({
      where: { key: "branded_reference_badge_enabled" },
      select: { value: true },
    }),
  ]);
  if (!product) {
    return { success: false, error: `Aucun produit BJ avec la référence « ${trimmedRef} ».` };
  }

  const jobId = await createMicrostoreUploadJob({
    productId: product.id,
    reference: product.reference,
    productName: product.name ?? null,
  });
  const brandedBadgeEnabled = brandedBadgeRow?.value === "true";

  const imagesByColorId = new Map<string, string[]>();
  for (const img of product.colorImages) {
    if (!img.colorId || !img.path) continue;
    const list = imagesByColorId.get(img.colorId) ?? [];
    list.push(img.path);
    imagesByColorId.set(img.colorId, list);
  }

  const primaryColorId =
    product.primaryColorId ||
    product.colors.find((c) => c.isPrimary)?.color?.id ||
    null;
  const sortedColors = [...product.colors].sort((a, b) => {
    const aIsPrimary = a.color?.id === primaryColorId ? 1 : 0;
    const bIsPrimary = b.color?.id === primaryColorId ? 1 : 0;
    return bIsPrimary - aIsPrimary;
  });

  let company;
  try {
    company = await getMicrostorePictureStationCompany(stored.key);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Erreur inconnue.";
    logger.error("[Microstore/PS] company fetch failed", { error: err });
    await markMicrostoreUploadJobStatus(jobId, "FAILED", {
      errorMessage: `Contact Microstore impossible : ${message}`,
      completed: true,
    });
    return { success: false, error: `Contact Microstore impossible : ${message}` };
  }

  let mstGoods;
  try {
    mstGoods = await getMicrostoreGoodsByItemRef(stored.key, trimmedRef);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Erreur inconnue.";
    await markMicrostoreUploadJobStatus(jobId, "FAILED", {
      errorMessage: `Recherche Microstore échouée : ${message}`,
      completed: true,
    });
    return { success: false, error: `Recherche Microstore échouée : ${message}` };
  }
  if (!mstGoods) {
    const message = `Aucun produit Microstore avec la référence « ${trimmedRef} ». Publie-le d'abord depuis la boutique.`;
    await markMicrostoreUploadJobStatus(jobId, "FAILED", {
      errorMessage: message,
      completed: true,
    });
    return { success: false, error: message };
  }

  let plannedTotal = 0;
  for (const pc of sortedColors) {
    const colorId = pc.color?.id || "";
    const colorName = pc.color?.name || "";
    if (!colorName) continue;
    const localPaths = (imagesByColorId.get(colorId) ?? []).filter((p) => !!p);
    const matches = mstGoods.skus.filter(
      (s) => s.colorName.toLowerCase() === colorName.toLowerCase(),
    );
    if (matches.length === 0 || localPaths.length === 0) continue;
    const isPrimary = colorId === primaryColorId;
    plannedTotal += localPaths.length + (brandedBadgeEnabled && isPrimary ? 1 : 0);
  }
  await markMicrostoreUploadJobStarted(jobId, plannedTotal);

  const path = await import("node:path");
  const fs = await import("node:fs/promises");
  const colorsResult: NonNullable<SendProductPhotosResult["colors"]> = [];
  const skuImage: { skuIds: number[]; images: string[] }[] = [];
  let anyUpload = false;
  let coverImage = "";

  for (const pc of sortedColors) {
    const colorName = pc.color?.name || "";
    const colorId = pc.color?.id || "";
    if (!colorName) continue;
    const localPaths = (imagesByColorId.get(colorId) ?? []).filter((p) => !!p);
    const isPrimaryColor = colorId === primaryColorId;

    const matches = mstGoods.skus.filter(
      (s) => s.colorName.toLowerCase() === colorName.toLowerCase(),
    );

    if (matches.length === 0) {
      colorsResult.push({
        colorName,
        matchedMicrostoreColor: null,
        matchedSkuIds: [],
        uploadedUrls: [],
        imagesLocal: localPaths,
        error: "Aucune couleur Microstore équivalente.",
      });
      continue;
    }

    if (localPaths.length === 0) {
      colorsResult.push({
        colorName,
        matchedMicrostoreColor: matches[0].colorName,
        matchedSkuIds: matches.map((m) => m.skuId),
        uploadedUrls: [],
        imagesLocal: [],
        error: "Aucune photo côté boutique BJ.",
      });
      continue;
    }

    const uploadedUrls: string[] = [];
    let uploadError: string | undefined;
    for (let idx = 0; idx < localPaths.length; idx++) {
      const rel = localPaths[idx];
      try {
        const absolutePath = path.join(
          process.cwd(),
          "public",
          rel.replace(/^\/+/, ""),
        );
        const sourceBuffer = await fs.readFile(absolutePath);
        const applyBadge = brandedBadgeEnabled && isPrimaryColor && idx === 0;
        const jpegBuffer = await prepareMicrostoreJpeg(
          sourceBuffer,
          applyBadge ? product.reference : undefined,
        );

        const filename = path.basename(rel).replace(/\.[a-zA-Z0-9]+$/, "") + ".jpg";
        const uploaded = await uploadImageToMicrostoreOss(
          stored.key,
          company.companyId,
          jpegBuffer,
          filename,
        );
        uploadedUrls.push(uploaded.publicUrl);
        anyUpload = true;
        await bumpMicrostoreUploadJobCounters(jobId, { uploaded: 1 });
        if (!coverImage) coverImage = uploaded.publicUrl;

        if (applyBadge) {
          const originalJpeg = await prepareMicrostoreJpeg(sourceBuffer);
          const originalFilename = filename.replace(/\.jpg$/, "-orig.jpg");
          const originalUpload = await uploadImageToMicrostoreOss(
            stored.key,
            company.companyId,
            originalJpeg,
            originalFilename,
          );
          uploadedUrls.push(originalUpload.publicUrl);
          await bumpMicrostoreUploadJobCounters(jobId, { uploaded: 1 });
        }
      } catch (err) {
        uploadError = err instanceof Error ? err.message : String(err);
        logger.error("[Microstore/PS] image upload failed", {
          error: err,
          path: rel,
          colorName,
        });
        await bumpMicrostoreUploadJobCounters(jobId, { failed: 1 });
        break;
      }
    }

    colorsResult.push({
      colorName,
      matchedMicrostoreColor: matches[0].colorName,
      matchedSkuIds: matches.map((m) => m.skuId),
      uploadedUrls,
      imagesLocal: localPaths,
      error: uploadError,
    });

    if (uploadedUrls.length > 0) {
      skuImage.push({
        skuIds: matches.map((m) => m.skuId),
        images: uploadedUrls,
      });
    }
  }

  if (!anyUpload) {
    const message =
      "Aucune photo n'a pu être envoyée. Vérifie les couleurs et les fichiers.";
    await markMicrostoreUploadJobStatus(jobId, "FAILED", {
      errorMessage: message,
      completed: true,
    });
    return {
      success: false,
      error: message,
      reference: product.reference,
      microstoreGoodsId: mstGoods.goodsId,
      microstoreGoodsName: mstGoods.name,
      companyName: company.companyName,
      colors: colorsResult,
    };
  }

  await markMicrostoreUploadJobStatus(jobId, "PATCHING");
  try {
    await patchMicrostoreGoodsImages(stored.key, mstGoods.goodsId, {
      coverImage,
      mainImages: [],
      imageSetting: { skuImage },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await markMicrostoreUploadJobStatus(jobId, "FAILED", {
      errorMessage: `PATCH images refusé par Microstore : ${message}`,
      completed: true,
    });
    return {
      success: false,
      error: `Upload OK mais PATCH images refusé par Microstore : ${message}`,
      reference: product.reference,
      microstoreGoodsId: mstGoods.goodsId,
      microstoreGoodsName: mstGoods.name,
      companyName: company.companyName,
      colors: colorsResult,
    };
  }

  await prisma.product.update({
    where: { id: product.id },
    data: {
      microstoreSyncRequired: false,
      microstoreLastPushedAt: new Date(),
    },
  });
  await markMicrostoreUploadJobStatus(jobId, "DONE", { completed: true });

  return {
    success: true,
    reference: product.reference,
    microstoreGoodsId: mstGoods.goodsId,
    microstoreGoodsName: mstGoods.name,
    companyName: company.companyName,
    colors: colorsResult,
  };
}

/**
 * Envoi photos en mode bulk — cœur métier sans requireAdmin.
 * Voir la server action `bulkSendPhotosToMicrostore` pour l'API publique.
 */
export async function bulkSendPhotosToMicrostoreCore(
  productIds: string[],
): Promise<BulkSendPhotosResult> {
  if (productIds.length === 0) {
    return {
      success: true,
      attempted: 0,
      photosUploaded: 0,
      successCount: 0,
      failedCount: 0,
      skippedProducts: [],
      coversPatched: 0,
      coversFailed: 0,
    };
  }

  const preflight = await assertMicrostorePushAllowed();
  if (!preflight.ok) {
    return {
      success: false,
      error: preflight.error,
      attempted: productIds.length,
      photosUploaded: 0,
      successCount: 0,
      failedCount: productIds.length,
      skippedProducts: [],
      coversPatched: 0,
      coversFailed: 0,
    };
  }

  const stored = await getStoredPictureStation();
  if (!stored) {
    return {
      success: false,
      error: "Aucun lien de station de transfert configuré.",
      attempted: productIds.length,
      photosUploaded: 0,
      successCount: 0,
      failedCount: productIds.length,
      skippedProducts: [],
      coversPatched: 0,
      coversFailed: 0,
    };
  }

  const { prisma } = await import("@/lib/prisma");
  const [products, brandedBadgeRow] = await Promise.all([
    prisma.product.findMany({
      where: { id: { in: productIds } },
      select: {
        id: true,
        reference: true,
        name: true,
        primaryColorId: true,
        colors: {
          where: { saleType: "UNIT" },
          select: {
            isPrimary: true,
            color: { select: { id: true, name: true } },
          },
        },
        colorImages: {
          orderBy: { order: "asc" },
          select: { path: true, order: true, colorId: true },
        },
      },
    }),
    prisma.siteConfig.findFirst({
      where: { key: "branded_reference_badge_enabled" },
      select: { value: true },
    }),
  ]);
  const brandedBadgeEnabled = brandedBadgeRow?.value === "true";

  const jobIdByProductId = new Map<string, string | null>();
  for (const p of products) {
    const jobId = await createMicrostoreUploadJob({
      productId: p.id,
      reference: p.reference,
      productName: p.name ?? null,
    });
    jobIdByProductId.set(p.id, jobId);
  }

  let company;
  try {
    company = await getMicrostorePictureStationCompany(stored.key);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Erreur inconnue.";
    for (const jobId of jobIdByProductId.values()) {
      await markMicrostoreUploadJobStatus(jobId, "FAILED", {
        errorMessage: `Contact Microstore impossible : ${message}`,
        completed: true,
      });
    }
    return {
      success: false,
      error: `Contact Microstore impossible : ${message}`,
      attempted: productIds.length,
      photosUploaded: 0,
      successCount: 0,
      failedCount: productIds.length,
      skippedProducts: [],
      coversPatched: 0,
      coversFailed: 0,
    };
  }

  const path = await import("node:path");
  const fs = await import("node:fs/promises");
  const pictures: MicrostoreBulkPictureEntry[] = [];
  const productsWithUpload = new Set<string>();
  const skippedProducts: string[] = [];
  const coverByProduct = new Map<
    string,
    { reference: string; primaryUrl: string | null; fallbackUrl: string | null }
  >();

  for (const product of products) {
    const imagesByColorId = new Map<string, string[]>();
    for (const img of product.colorImages) {
      if (!img.colorId || !img.path) continue;
      const list = imagesByColorId.get(img.colorId) ?? [];
      list.push(img.path);
      imagesByColorId.set(img.colorId, list);
    }

    const primaryColorId =
      product.primaryColorId ||
      product.colors.find((c) => c.isPrimary)?.color?.id ||
      null;

    const sortedColors = [...product.colors].sort((a, b) => {
      const aIsPrimary = a.color?.id === primaryColorId ? 1 : 0;
      const bIsPrimary = b.color?.id === primaryColorId ? 1 : 0;
      return bIsPrimary - aIsPrimary;
    });

    coverByProduct.set(product.id, {
      reference: product.reference,
      primaryUrl: null,
      fallbackUrl: null,
    });

    const jobId = jobIdByProductId.get(product.id) ?? null;
    let plannedForProduct = 0;
    for (const pc of sortedColors) {
      const colorId = pc.color?.id || "";
      const colorName = pc.color?.name || "";
      if (!colorName) continue;
      const localPaths = imagesByColorId.get(colorId) ?? [];
      if (localPaths.length === 0) continue;
      const isPrimary = colorId === primaryColorId;
      plannedForProduct +=
        localPaths.length + (brandedBadgeEnabled && isPrimary ? 1 : 0);
    }
    await markMicrostoreUploadJobStarted(jobId, plannedForProduct);

    let anyForProduct = false;
    for (const pc of sortedColors) {
      const colorName = pc.color?.name || "";
      const colorId = pc.color?.id || "";
      if (!colorName) continue;
      const isPrimaryColor = colorId === primaryColorId;
      const localPaths = imagesByColorId.get(colorId) ?? [];

      for (let idx = 0; idx < localPaths.length; idx++) {
        const rel = localPaths[idx];
        try {
          const absolutePath = path.join(
            process.cwd(),
            "public",
            rel.replace(/^\/+/, ""),
          );
          const sourceBuffer = await fs.readFile(absolutePath);
          const applyBadge = brandedBadgeEnabled && isPrimaryColor && idx === 0;
          const jpegBuffer = await prepareMicrostoreJpeg(
            sourceBuffer,
            applyBadge ? product.reference : undefined,
          );

          const filename =
            path.basename(rel).replace(/\.[a-zA-Z0-9]+$/, "") + ".jpg";
          const uploaded = await uploadImageToMicrostoreOss(
            stored.key,
            company.companyId,
            jpegBuffer,
            filename,
          );

          pictures.push({
            name: `${product.reference} ${colorName} ${idx + 1}`,
            fileName: filename,
            image: uploaded.publicUrl,
            goodsImageSetting: {
              itemRef: product.reference,
              colorName,
              order: idx + 1,
            },
          });
          anyForProduct = true;
          await bumpMicrostoreUploadJobCounters(jobId, { uploaded: 1 });

          const entry = coverByProduct.get(product.id)!;
          if (!entry.fallbackUrl) entry.fallbackUrl = uploaded.publicUrl;
          if (isPrimaryColor && idx === 0 && !entry.primaryUrl) {
            entry.primaryUrl = uploaded.publicUrl;
          }

          if (applyBadge) {
            const originalJpeg = await prepareMicrostoreJpeg(sourceBuffer);
            const originalFilename = filename.replace(/\.jpg$/, "-orig.jpg");
            const originalUpload = await uploadImageToMicrostoreOss(
              stored.key,
              company.companyId,
              originalJpeg,
              originalFilename,
            );
            pictures.push({
              name: `${product.reference} ${colorName} ${idx + 2} (originale)`,
              fileName: originalFilename,
              image: originalUpload.publicUrl,
              goodsImageSetting: {
                itemRef: product.reference,
                colorName,
                order: idx + 2,
              },
            });
            await bumpMicrostoreUploadJobCounters(jobId, { uploaded: 1 });
          }
        } catch (err) {
          logger.error("[Microstore/PS] bulk upload failed", {
            error: err,
            reference: product.reference,
            path: rel,
          });
          await bumpMicrostoreUploadJobCounters(jobId, { failed: 1 });
        }
      }
    }

    if (anyForProduct) {
      productsWithUpload.add(product.id);
    } else {
      skippedProducts.push(product.reference);
      await markMicrostoreUploadJobStatus(jobId, "FAILED", {
        errorMessage: "Aucune photo n'a pu être uploadée pour ce produit.",
        completed: true,
      });
    }
  }

  if (pictures.length === 0) {
    return {
      success: false,
      error: "Aucune photo à envoyer sur cette sélection.",
      attempted: productIds.length,
      photosUploaded: 0,
      successCount: 0,
      failedCount: productIds.length,
      skippedProducts,
      coversPatched: 0,
      coversFailed: 0,
    };
  }

  for (const productId of productsWithUpload) {
    await markMicrostoreUploadJobStatus(
      jobIdByProductId.get(productId) ?? null,
      "PATCHING",
    );
  }

  let bulkRes;
  try {
    bulkRes = await bulkImportMicrostorePictures(stored.key, pictures);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    for (const productId of productsWithUpload) {
      await markMicrostoreUploadJobStatus(
        jobIdByProductId.get(productId) ?? null,
        "FAILED",
        {
          errorMessage: `Upload OSS OK mais bulk pictureStations refusé : ${message}`,
          completed: true,
        },
      );
    }
    return {
      success: false,
      error: `Upload OSS OK mais l'appel bulk pictureStations a échoué : ${message}`,
      attempted: productIds.length,
      photosUploaded: pictures.length,
      successCount: 0,
      failedCount: productIds.length,
      skippedProducts,
      coversPatched: 0,
      coversFailed: 0,
    };
  }

  if (productsWithUpload.size > 0) {
    await prisma.product.updateMany({
      where: { id: { in: Array.from(productsWithUpload) } },
      data: {
        microstoreSyncRequired: false,
        microstoreLastPushedAt: new Date(),
      },
    });
  }

  let coversPatched = 0;
  let coversFailed = 0;
  for (const productId of Array.from(productsWithUpload)) {
    const entry = coverByProduct.get(productId);
    const jobId = jobIdByProductId.get(productId) ?? null;
    if (!entry) {
      await markMicrostoreUploadJobStatus(jobId, "DONE", { completed: true });
      continue;
    }
    const coverUrl = entry.primaryUrl || entry.fallbackUrl;
    if (!coverUrl) {
      await markMicrostoreUploadJobStatus(jobId, "DONE", { completed: true });
      continue;
    }
    try {
      const mstGoods = await getMicrostoreGoodsByItemRef(stored.key, entry.reference);
      if (!mstGoods) {
        coversFailed++;
        logger.warn("[Microstore/PS] cover PATCH skipped: goods not found", {
          reference: entry.reference,
        });
        await prisma.product.update({
          where: { id: productId },
          data: { microstoreSyncRequired: true },
        });
        await markMicrostoreUploadJobStatus(jobId, "FAILED", {
          errorMessage: `Photos uploadées mais fiche Microstore introuvable pour la couverture.`,
          completed: true,
        });
        continue;
      }
      await patchMicrostoreGoodsImages(stored.key, mstGoods.goodsId, {
        coverImage: coverUrl,
        mainImages: [],
      });
      coversPatched++;
      await markMicrostoreUploadJobStatus(jobId, "DONE", { completed: true });
    } catch (err) {
      coversFailed++;
      const message = err instanceof Error ? err.message : String(err);
      logger.error("[Microstore/PS] cover PATCH failed", {
        error: err,
        reference: entry.reference,
      });
      await prisma.product.update({
        where: { id: productId },
        data: { microstoreSyncRequired: true },
      });
      await markMicrostoreUploadJobStatus(jobId, "FAILED", {
        errorMessage: `Photos uploadées mais PATCH couverture refusé : ${message}`,
        completed: true,
      });
    }
  }

  return {
    success: bulkRes.failedCount === 0,
    attempted: productIds.length,
    photosUploaded: pictures.length,
    successCount: bulkRes.successCount,
    failedCount: bulkRes.failedCount,
    skippedProducts,
    coversPatched,
    coversFailed,
  };
}
