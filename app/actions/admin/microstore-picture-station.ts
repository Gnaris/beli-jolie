"use server";

/**
 * Server actions — Station de transfert d'images Microstore.
 *
 * L'admin colle ici le lien de partage `https://microstore.app/s/xxxxx`
 * généré depuis son back Microstore. On valide auprès de Microstore, on
 * persiste le key chiffré + l'expiration, puis on l'utilise pour uploader
 * les photos produits (étapes suivantes).
 */

import { revalidatePath, revalidateTag } from "next/cache";
import { requireAdmin } from "@/lib/auth-helpers";
import { logger } from "@/lib/logger";
import { setSiteConfig, unsetSiteConfig } from "@/lib/site-config-write";
import {
  extractPictureStationKey,
  validatePictureStationKey,
  getStoredPictureStation,
  getMicrostorePictureStationCompany,
  uploadImageToMicrostoreOss,
  getMicrostoreGoodsByItemRef,
  patchMicrostoreGoodsImages,
  bulkImportMicrostorePictures,
  type MicrostoreBulkPictureEntry,
} from "@/lib/microstore-picture-station";

/**
 * Prépare un buffer image prêt à être uploadé vers Microstore :
 *  1. Applique le badge référence si `brandedReference` est fourni
 *  2. Ré-encode systématiquement en JPEG (Microstore attend du JPEG dans les
 *     HAR de production ; envoyer du WebP dans un `.JPG` fait échouer
 *     silencieusement le badge)
 *
 * Sharp est chargé via import dynamique pour rester compatible avec les
 * chemins server-only qui n'utilisent pas la Station de Transfert.
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

export interface SavePictureStationResult {
  success: boolean;
  error?: string;
  expiresAtIso?: string;
}

/**
 * Enregistre un lien de station de transfert Microstore. Accepte :
 *  - `https://microstore.app/s/xxxxx` (URL courte)
 *  - `https://<tenant>.microstore.app/imageTransferStation#/…?key=XXX`
 *  - le key nu (`NBqdsz`)
 */
export async function saveMicrostorePictureStation(
  input: string,
): Promise<SavePictureStationResult> {
  await requireAdmin();

  const trimmed = (input || "").trim();
  if (!trimmed) {
    return { success: false, error: "Collez le lien de la station de transfert." };
  }

  let key: string | null = null;
  try {
    key = await extractPictureStationKey(trimmed);
  } catch (err) {
    logger.error("[Microstore/PS] extractKey failed", { error: err });
    return { success: false, error: "Impossible de lire le lien." };
  }
  if (!key) {
    return { success: false, error: "Ce lien ne contient pas de clé de station reconnaissable." };
  }

  let validation;
  try {
    validation = await validatePictureStationKey(key);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Validation impossible.";
    return { success: false, error: message };
  }

  await setSiteConfig("microstore_picture_station_key", validation.key);
  await setSiteConfig(
    "microstore_picture_station_expires_at",
    String(validation.expiresAt.getTime()),
  );
  await setSiteConfig("microstore_picture_station_short_url", trimmed);

  revalidateTag("site-config", "default");
  revalidatePath("/admin/parametres");

  return { success: true, expiresAtIso: validation.expiresAt.toISOString() };
}

/** Retire le lien de station de transfert. */
export async function clearMicrostorePictureStation(): Promise<{ success: true }> {
  await requireAdmin();
  await unsetSiteConfig("microstore_picture_station_key");
  await unsetSiteConfig("microstore_picture_station_expires_at");
  await unsetSiteConfig("microstore_picture_station_short_url");
  revalidateTag("site-config", "default");
  revalidatePath("/admin/parametres");
  return { success: true };
}

/**
 * Retourne l'état du lien pour l'UI (utilisé par le composant client au chargement).
 */
export async function getMicrostorePictureStationState(): Promise<{
  configured: boolean;
  expiresAtIso: string | null;
  shortUrl: string | null;
}> {
  await requireAdmin();
  const stored = await getStoredPictureStation();
  if (!stored) return { configured: false, expiresAtIso: null, shortUrl: null };
  return {
    configured: true,
    expiresAtIso: stored.expiresAt.toISOString(),
    shortUrl: stored.shortUrl,
  };
}

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

/**
 * Envoie les photos d'un produit BJ (recherché par sa référence) vers son
 * homologue Microstore. Une photo par couleur BJ est uploadée vers le CDN
 * Microstore, puis un PATCH `/api/goods/{goodsId}` assigne ces URLs aux
 * bons `skuIds` par matching de nom de couleur (case-insensitive).
 *
 * Ordre du flux :
 *  1. Charge le pictureStationKey stocké
 *  2. Charge le Product BJ par référence (avec ProductColor + Color + images)
 *  3. GET `/api/companies/goods/itemRef?itemRef=REF` → goodsId + skus Microstore
 *  4. Pour chaque ProductColor UNIT :
 *     - Match Color.name ↔ Microstore.skus[].colorName (case-insensitive)
 *     - Lit chaque fichier image sur disque (public/uploads/…)
 *     - Upload à OSS Microstore, récupère l'URL CDN
 *  5. PATCH `/api/goods/{goodsId}` avec l'imageSetting complet
 *  6. Retour d'un résumé détaillé pour l'UI
 *
 * Attention : le PATCH remplace complètement les images des SKUs listés
 * chez Microstore.
 */
export async function sendProductPhotosToMicrostore(
  reference: string,
): Promise<SendProductPhotosResult> {
  await requireAdmin();

  const trimmedRef = (reference || "").trim();
  if (!trimmedRef) {
    return { success: false, error: "Référence produit manquante." };
  }

  const stored = await getStoredPictureStation();
  if (!stored) {
    return { success: false, error: "Aucun lien de station de transfert configuré." };
  }

  // 1. Charge le produit BJ + ses ProductColor + images
  // NB : on ne charge PAS `productColor.images` via la relation car le champ
  // ProductColorImage.productColorId est nullable et souvent vide sur les
  // anciens produits. On charge séparément `product.colorImages` puis on
  // regroupe par colorId — approche fiable quel que soit le legacy.
  const { prisma } = await import("@/lib/prisma");
  const [product, brandedBadgeRow] = await Promise.all([
    prisma.product.findFirst({
      where: { reference: trimmedRef },
      select: {
        id: true,
        reference: true,
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
  const brandedBadgeEnabled = brandedBadgeRow?.value === "true";

  // Regroupe les images par colorId pour un accès O(1) plus loin.
  const imagesByColorId = new Map<string, string[]>();
  for (const img of product.colorImages) {
    if (!img.colorId || !img.path) continue;
    const list = imagesByColorId.get(img.colorId) ?? [];
    list.push(img.path);
    imagesByColorId.set(img.colorId, list);
  }

  // Détermine la couleur primaire — sert au tri (envoyer en premier) ET à
  // décider où appliquer le badge référence sur la 1re image.
  const primaryColorId =
    product.primaryColorId ||
    product.colors.find((c) => c.isPrimary)?.color?.id ||
    null;
  const sortedColors = [...product.colors].sort((a, b) => {
    const aIsPrimary = a.color?.id === primaryColorId ? 1 : 0;
    const bIsPrimary = b.color?.id === primaryColorId ? 1 : 0;
    return bIsPrimary - aIsPrimary;
  });

  // 2. Company info (companyId pour OSS key)
  let company;
  try {
    company = await getMicrostorePictureStationCompany(stored.key);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Erreur inconnue.";
    logger.error("[Microstore/PS] company fetch failed", { error: err });
    return { success: false, error: `Contact Microstore impossible : ${message}` };
  }

  // 3. Cherche le produit chez Microstore
  let mstGoods;
  try {
    mstGoods = await getMicrostoreGoodsByItemRef(stored.key, trimmedRef);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Erreur inconnue.";
    return { success: false, error: `Recherche Microstore échouée : ${message}` };
  }
  if (!mstGoods) {
    return {
      success: false,
      error: `Aucun produit Microstore avec la référence « ${trimmedRef} ». Publie-le d'abord depuis la boutique.`,
    };
  }

  // 4. Upload photos par couleur BJ
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

    // Match couleur BJ ↔ SKU Microstore (case-insensitive)
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
        // Les paths BDD commencent par /uploads/… → on cherche dans public/
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

        // Nom d'origine → .jpg (le contenu est du JPEG maintenant).
        const filename = path.basename(rel).replace(/\.[a-zA-Z0-9]+$/, "") + ".jpg";
        const uploaded = await uploadImageToMicrostoreOss(
          stored.key,
          company.companyId,
          jpegBuffer,
          filename,
        );
        uploadedUrls.push(uploaded.publicUrl);
        anyUpload = true;
        // La couleur primaire est envoyée en premier, donc sa 1re image
        // devient naturellement la couverture (cf. tri sortedColors).
        if (!coverImage) coverImage = uploaded.publicUrl;
      } catch (err) {
        uploadError = err instanceof Error ? err.message : String(err);
        logger.error("[Microstore/PS] image upload failed", {
          error: err,
          path: rel,
          colorName,
        });
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
    return {
      success: false,
      error: "Aucune photo n'a pu être envoyée. Vérifie les couleurs et les fichiers.",
      reference: product.reference,
      microstoreGoodsId: mstGoods.goodsId,
      microstoreGoodsName: mstGoods.name,
      companyName: company.companyName,
      colors: colorsResult,
    };
  }

  // 5. PATCH Microstore avec l'imageSetting complet
  try {
    await patchMicrostoreGoodsImages(stored.key, mstGoods.goodsId, {
      coverImage,
      mainImages: [],
      imageSetting: { skuImage },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
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

  // 6. Succès — on baisse le flag de synchro et on note l'horodatage. Ce
  // même comportement que les autres marketplaces éteint le badge orange
  // « Synchro nécessaire » côté fiche produit et liste produits.
  await prisma.product.update({
    where: { id: product.id },
    data: {
      microstoreSyncRequired: false,
      microstoreLastPushedAt: new Date(),
    },
  });

  return {
    success: true,
    reference: product.reference,
    microstoreGoodsId: mstGoods.goodsId,
    microstoreGoodsName: mstGoods.name,
    companyName: company.companyName,
    colors: colorsResult,
  };
}

export interface BulkSendPhotosResult {
  success: boolean;
  error?: string;
  attempted: number;
  photosUploaded: number;
  successCount: number;
  failedCount: number;
  skippedProducts: string[];
}

/**
 * Envoi de photos en **mode masse** vers Microstore — utilisé après un
 * `bulkPushProductsToMicrostore` pour synchroniser les images d'un lot.
 *
 * Différence avec le mode mono (`sendProductPhotosToMicrostore`) :
 *   - N produits × M couleurs × K photos → upload OSS en parallèle
 *   - Puis **un seul** `POST /api/v3/pictureStations?importToGoods=true`
 *     avec tout le catalogue d'images en payload
 *   - Microstore fait le matching côté serveur via `itemRef` + `colorName`
 *
 * Beaucoup plus économe en appels API pour un gros lot (1 POST au lieu de N
 * PATCH).
 *
 * Effets de bord :
 *   - Reset `microstoreSyncRequired = false` sur chaque produit ayant réussi
 *     au moins une couleur
 *   - Applique le badge référence sur la 1re image de la couleur primaire
 *     (comme le mode mono)
 */
export async function bulkSendPhotosToMicrostore(
  productIds: string[],
): Promise<BulkSendPhotosResult> {
  await requireAdmin();

  if (productIds.length === 0) {
    return {
      success: true,
      attempted: 0,
      photosUploaded: 0,
      successCount: 0,
      failedCount: 0,
      skippedProducts: [],
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
    };
  }

  const { prisma } = await import("@/lib/prisma");
  const [products, brandedBadgeRow] = await Promise.all([
    prisma.product.findMany({
      where: { id: { in: productIds } },
      select: {
        id: true,
        reference: true,
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

  let company;
  try {
    company = await getMicrostorePictureStationCompany(stored.key);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Erreur inconnue.";
    return {
      success: false,
      error: `Contact Microstore impossible : ${message}`,
      attempted: productIds.length,
      photosUploaded: 0,
      successCount: 0,
      failedCount: productIds.length,
      skippedProducts: [],
    };
  }

  const path = await import("node:path");
  const fs = await import("node:fs/promises");
  const pictures: MicrostoreBulkPictureEntry[] = [];
  const productsWithUpload = new Set<string>();
  const skippedProducts: string[] = [];

  for (const product of products) {
    // Regroupe les images par colorId
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

    let anyForProduct = false;
    for (const pc of product.colors) {
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
        } catch (err) {
          logger.error("[Microstore/PS] bulk upload failed", {
            error: err,
            reference: product.reference,
            path: rel,
          });
        }
      }
    }

    if (anyForProduct) {
      productsWithUpload.add(product.id);
    } else {
      skippedProducts.push(product.reference);
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
    };
  }

  let bulkRes;
  try {
    bulkRes = await bulkImportMicrostorePictures(stored.key, pictures);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      success: false,
      error: `Upload OSS OK mais l'appel bulk pictureStations a échoué : ${message}`,
      attempted: productIds.length,
      photosUploaded: pictures.length,
      successCount: 0,
      failedCount: productIds.length,
      skippedProducts,
    };
  }

  // Baisse le flag pour les produits ayant eu au moins un upload OSS réussi.
  if (productsWithUpload.size > 0) {
    await prisma.product.updateMany({
      where: { id: { in: Array.from(productsWithUpload) } },
      data: {
        microstoreSyncRequired: false,
        microstoreLastPushedAt: new Date(),
      },
    });
  }

  return {
    success: bulkRes.failedCount === 0,
    attempted: productIds.length,
    photosUploaded: pictures.length,
    successCount: bulkRes.successCount,
    failedCount: bulkRes.failedCount,
    skippedProducts,
  };
}
