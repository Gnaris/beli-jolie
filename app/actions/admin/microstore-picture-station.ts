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
import {
  createMicrostoreUploadJob,
  markMicrostoreUploadJobStarted,
  bumpMicrostoreUploadJobCounters,
  markMicrostoreUploadJobStatus,
} from "@/lib/microstore-upload-jobs";

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

  // Suivi widget flottant : un job = ce produit. Créé une fois qu'on a le
  // produit BJ (avant ça on n'a même pas de nom à afficher). Toutes les
  // sorties suivantes doivent marquer le job DONE ou FAILED — le helper
  // gère silencieusement l'absence de tenant / de tid.
  const jobId = await createMicrostoreUploadJob({
    productId: product.id,
    reference: product.reference,
    productName: product.name ?? null,
  });
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
    await markMicrostoreUploadJobStatus(jobId, "FAILED", {
      errorMessage: `Contact Microstore impossible : ${message}`,
      completed: true,
    });
    return { success: false, error: `Contact Microstore impossible : ${message}` };
  }

  // 3. Cherche le produit chez Microstore
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

  // Calcule le total prévu de photos à uploader (matchées + fichiers dispos).
  // La couleur principale a +1 (originale sans badge) si le badge est actif.
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

  // 4. Upload photos par couleur BJ
  // NB : le carousel principal (`mainImages`) reste vide — Microstore l'utilise
  // pour des photos "hors couleur" que la cliente ne veut pas mettre en avant.
  // Pour la couleur principale, on envoie DEUX images dans son SKU : la
  // brandée (avec le badge « RÉFÉRENCE ») ET l'originale sans badge. Les
  // autres couleurs ont 1 seule image (l'originale). Résultat côté Microstore :
  //   - miniature liste boutique : brandée (coverImage)
  //   - carousel principal fiche : vide (comportement voulu)
  //   - sélection couleur principale : 2 photos (brandée puis originale)
  //   - sélection autres couleurs : 1 photo (originale)
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
        await bumpMicrostoreUploadJobCounters(jobId, { uploaded: 1 });
        // La couleur primaire est envoyée en premier, donc sa 1re image
        // devient naturellement la couverture (cf. tri sortedColors).
        if (!coverImage) coverImage = uploaded.publicUrl;

        // Quand on vient d'uploader la brandée de la couleur principale, on
        // uploade en plus la version originale (sans badge) et on l'ajoute
        // à la liste du même SKU. La couleur principale aura donc 2 photos
        // dans son onglet côté Microstore (brandée puis originale).
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

  // 5. PATCH Microstore avec l'imageSetting complet
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

export interface BulkSendPhotosResult {
  success: boolean;
  error?: string;
  attempted: number;
  photosUploaded: number;
  successCount: number;
  failedCount: number;
  skippedProducts: string[];
  /**
   * Nombre de produits pour lesquels on a réussi à propager la "photo
   * couverture" (`coverImage`) via un PATCH `/api/goods/{id}` supplémentaire
   * après le bulk. L'endpoint bulk `/api/v3/pictureStations` ne gère pas la
   * photo couverture — on la pose ensuite, une par produit.
   */
  coversPatched: number;
  /** Produits où le PATCH de la photo couverture a échoué (log + rapport). */
  coversFailed: number;
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
 *   - Après le bulk POST : PATCH individuel `/api/goods/{id}` par produit
 *     pour poser `coverImage` = 1re photo de la couleur principale (fallback
 *     sur la 1re photo uploadée si la couleur principale n'a aucune photo)
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

  // Un job par produit. Créés à l'avance pour que le widget affiche la
  // totalité du lot dès le clic, puis mis à jour au fil de l'upload.
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
    // Aucun contact Microstore possible → tous les jobs échouent d'un coup.
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
  // Par produit : URL à utiliser comme "photo couverture" côté Microstore.
  // `primaryUrl` = 1re photo de la couleur principale (idéal). `fallbackUrl` =
  // 1re photo uploadée toutes couleurs confondues (utilisée quand la couleur
  // principale n'a aucune photo — option (b) validée par la cliente).
  const coverByProduct = new Map<
    string,
    { reference: string; primaryUrl: string | null; fallbackUrl: string | null }
  >();

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

    // Trie les couleurs pour traiter la principale en 1er, comme le mode mono.
    // Effet secondaire propre : ses photos apparaissent en tête du bulk POST.
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

    // Calcule le total prévu pour ce produit et bascule le job en UPLOADING.
    // On ne compte que les photos dont le fichier existe localement — on ne
    // peut pas prédire les couleurs matchées côté Microstore ici (le matching
    // se fait côté serveur Microstore via le POST bulk). C'est donc un total
    // "photos qu'on va tenter d'uploader vers OSS".
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

          // Mémorise l'URL cover : primaryUrl seulement si c'est la 1re photo
          // de la couleur principale ; fallbackUrl sur le tout 1er upload.
          const entry = coverByProduct.get(product.id)!;
          if (!entry.fallbackUrl) entry.fallbackUrl = uploaded.publicUrl;
          if (isPrimaryColor && idx === 0 && !entry.primaryUrl) {
            entry.primaryUrl = uploaded.publicUrl;
          }

          // Si on vient d'uploader la brandée de la couleur principale, on
          // ajoute une 2e entry pour l'originale (sans badge) attribuée au
          // même SKU. La couleur principale aura donc 2 photos dans son
          // onglet côté Microstore (brandée puis originale).
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

  // Upload OSS terminé pour ces produits → phase PATCHING (bulk pictureStations
  // puis PATCH cover un par un).
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
    // Bulk global échoué → tous les produits en PATCHING passent FAILED.
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

  // Propage la "photo couverture" (couleur principale BJ → coverImage
  // Microstore). L'endpoint bulk `/api/v3/pictureStations` ne gère pas ce
  // champ — il faut un PATCH `/api/goods/{id}` par produit. Le PATCH avec
  // `imageSetting.skuImage: []` ne touche pas aux images par SKU déjà
  // uploadées (Microstore ne réassigne que les SKU listés — cf. doc du
  // `patchMicrostoreGoodsImages`). `mainImages: []` reste vide car le
  // carousel principal doit rester vide (l'originale de la couleur
  // principale est déjà attribuée à son SKU via le POST bulk juste avant).
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
      // Rien à propager en cover, mais le bulk POST est passé → succès.
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
        await markMicrostoreUploadJobStatus(jobId, "FAILED", {
          errorMessage: `Photos uploadées mais fiche Microstore introuvable pour la couverture.`,
          completed: true,
        });
        continue;
      }
      await patchMicrostoreGoodsImages(stored.key, mstGoods.goodsId, {
        coverImage: coverUrl,
        mainImages: [],
        imageSetting: { skuImage: [] },
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
