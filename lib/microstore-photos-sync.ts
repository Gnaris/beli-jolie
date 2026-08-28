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
import { getCurrentTenantIdSync } from "@/lib/tenant-als";

/**
 * File d'attente par tenant sur les envois photos Microstore.
 *
 * Pourquoi : Microstore répond HTTP 500 (« erreur système inconnu ») quand on
 * enchaîne 3-5 PATCH `/api/goods/{id}` en parallèle sur la même session
 * pictureStation. Cas concret 2026-08-28 : la cliente enregistre plusieurs
 * produits d'affilée, chaque save déclenche un fire-and-forget photos qui
 * collisionne avec le précédent → HTTP 500.
 *
 * Le mutex sérialise strictement 1 envoi photos à la fois PAR TENANT.
 * Les envois multi-tenant restent parallèles (jamais 2 pushs en concurrence
 * sur la même session Microstore d'un tenant).
 *
 * En mémoire process — suffisant tant qu'on tourne sur un seul Next.js.
 * Si un jour on scale horizontalement, il faudra passer sur un lock Redis
 * ou un BullMQ dédié.
 */
const microstorePhotoLockByTenant = new Map<string, Promise<unknown>>();

export async function withMicrostorePhotoLock<T>(
  fallbackTenantId: string | null,
  label: string,
  fn: () => Promise<T>,
): Promise<T> {
  const tid = getCurrentTenantIdSync() ?? fallbackTenantId ?? "__global__";
  const previous = microstorePhotoLockByTenant.get(tid) ?? Promise.resolve();
  let release!: (value: unknown) => void;
  const next = new Promise((resolve) => {
    release = resolve;
  });
  microstorePhotoLockByTenant.set(tid, next);
  try {
    await previous;
  } catch {
    // On avale l'erreur du précédent — chaque appel gère ses propres erreurs.
  }
  const waitedMs = Date.now();
  try {
    const result = await fn();
    return result;
  } finally {
    const durationMs = Date.now() - waitedMs;
    // Petite trace de diagnostic : si les envois s'accumulent, le durationMs
    // permet de repérer que la file bourre.
    if (durationMs > 15_000) {
      logger.warn(`[Microstore photos lock] ${label} a bloqué ${durationMs} ms`, {
        tenantId: tid,
      });
    }
    release(undefined);
    // Nettoie la map si personne d'autre n'a pris le lock derrière — évite
    // une fuite mémoire silencieuse sur les tenants inactifs.
    if (microstorePhotoLockByTenant.get(tid) === next) {
      microstorePhotoLockByTenant.delete(tid);
    }
  }
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
 *
 * Sérialisé par tenant via `withMicrostorePhotoLock` — un seul envoi photos
 * Microstore actif à la fois par tenant, pour éviter les HTTP 500
 * collisions.
 *
 * Skip automatique si le produit a `microstorePhotosDirty === false` (photos
 * inchangées depuis le dernier envoi). Passer `{ force: true }` pour outrepasser
 * ce garde-fou (ex : bouton « Renvoyer les photos » manuel).
 */
export async function sendProductPhotosToMicrostoreCore(
  reference: string,
  opts: { force?: boolean } = {},
): Promise<SendProductPhotosResult> {
  return withMicrostorePhotoLock(null, `sendProductPhotos(${reference})`, () =>
    sendProductPhotosToMicrostoreCoreUnlocked(reference, opts),
  );
}

async function sendProductPhotosToMicrostoreCoreUnlocked(
  reference: string,
  opts: { force?: boolean } = {},
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
        microstoreProductId: true,
        colors: {
          where: { saleType: "UNIT" },
          select: {
            id: true,
            isPrimary: true,
            microstoreVariantId: true,
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

  // Garde-fou « photos inchangées » : on saute l'envoi photos si aucun
  // fichier n'a bougé depuis le dernier push réussi. Économise ~5-10 s
  // d'API OSS + 1 PATCH Microstore par save fiche qui ne concerne que le
  // texte/prix. Contournement : `{ force: true }` (bouton « Renvoyer les
  // photos » côté UI). Le champ est lu à part car il n'est pas encore dans
  // les types Prisma générés (cast sur le select principal ferait perdre
  // les autres types).
  const dirtyRow = await prisma.product.findUnique({
    where: { id: product.id },
    select: { microstorePhotosDirty: true } as never,
  });
  const photosDirty = (dirtyRow as unknown as { microstorePhotosDirty?: boolean } | null)
    ?.microstorePhotosDirty;
  if (!opts.force && photosDirty === false) {
    logger.info("[Microstore/PS] photos inchangées — envoi sauté", {
      reference: trimmedRef,
    });
    return {
      success: true,
      reference: product.reference,
      microstoreGoodsId: product.microstoreProductId ?? undefined,
      microstoreGoodsName: product.name ?? "",
      companyName: "",
      colors: [],
    };
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

  // Lecture directe des IDs Microstore stockés en BDD au moment du /goods/add
  // ou /goods/update. On ne passe plus par le lookup H5 (endpoint
  // `/api/companies/goods/itemRef`), qui a un délai d'indexation de quelques
  // secondes après une création — chaîner immédiatement provoquait un faux
  // « Aucun produit Microstore avec la référence » (2026-08-25, produit
  // ADZSCS). Puisqu'on a déjà `microstoreProductId` + `microstoreVariantId`
  // par couleur en BDD, aucun aller-retour supplémentaire n'est nécessaire.
  const microstoreProductId = (product as unknown as { microstoreProductId: number | null })
    .microstoreProductId;
  if (!microstoreProductId) {
    const message = `« ${trimmedRef} » n'est pas encore publié sur Microstore. Envoie la fiche d'abord.`;
    await markMicrostoreUploadJobStatus(jobId, "FAILED", {
      errorMessage: message,
      completed: true,
    });
    return { success: false, error: message };
  }
  type ColorWithMst = { id: string; isPrimary: boolean; microstoreVariantId: number | null; color: { id: string; name: string } | null };
  const colorsWithMst = product.colors as unknown as ColorWithMst[];
  const skus = colorsWithMst
    .filter((c) => typeof c.microstoreVariantId === "number" && c.color)
    .map((c) => ({
      skuId: c.microstoreVariantId as number,
      colorId: 0,
      colorName: c.color!.name,
      sizeName: "",
    }));
  if (skus.length === 0) {
    const message =
      "Aucune variante Microstore connue pour ce produit. Envoie la fiche d'abord.";
    await markMicrostoreUploadJobStatus(jobId, "FAILED", {
      errorMessage: message,
      completed: true,
    });
    return { success: false, error: message };
  }
  const mstGoods = {
    goodsId: microstoreProductId,
    itemRef: product.reference,
    name: product.name ?? "",
    skus,
  };

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
      // Photos poussées avec succès : on nettoie le flag « dirty » pour que
      // le prochain enregistrement fiche seule ne redéclenche pas un envoi
      // photos inutile.
      microstorePhotosDirty: false,
    } as never,
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
 *
 * Sérialisé par tenant via `withMicrostorePhotoLock` — un bulk peut être
 * volumineux (N photos × M produits), on ne veut surtout pas qu'un envoi
 * unitaire lancé en parallèle vienne collisionner sur la même session.
 *
 * Filtre auto les produits `microstorePhotosDirty === false` (rien à
 * renvoyer). Passer `{ force: true }` pour tout renvoyer même les produits
 * dont les photos n'ont pas bougé.
 */
export async function bulkSendPhotosToMicrostoreCore(
  productIds: string[],
  opts: { force?: boolean } = {},
): Promise<BulkSendPhotosResult> {
  return withMicrostorePhotoLock(
    null,
    `bulkSendPhotos(${productIds.length} produits)`,
    () => bulkSendPhotosToMicrostoreCoreUnlocked(productIds, opts),
  );
}

async function bulkSendPhotosToMicrostoreCoreUnlocked(
  productIds: string[],
  opts: { force?: boolean } = {},
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
  const [productsRaw, brandedBadgeRow, dirtyRows] = await Promise.all([
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
    // Requête séparée pour lire microstorePhotosDirty — cast nécessaire
    // tant que le champ n'est pas dans les types Prisma générés.
    prisma.product.findMany({
      where: { id: { in: productIds } },
      select: { id: true, microstorePhotosDirty: true } as never,
    }),
  ]);
  const brandedBadgeEnabled = brandedBadgeRow?.value === "true";

  // Index le flag dirty par productId pour le filtre ci-dessous.
  const dirtyByProductId = new Map<string, boolean>();
  for (const row of dirtyRows as unknown as Array<{ id: string; microstorePhotosDirty?: boolean }>) {
    dirtyByProductId.set(row.id, row.microstorePhotosDirty !== false);
  }

  // Filtre les produits dont les photos n'ont pas bougé depuis le dernier
  // push réussi — évite des appels OSS + pictureStations inutiles quand un
  // save fiche ne touche ni les images, ni la primary color.
  const products: typeof productsRaw = [];
  const skippedForCleanPhotos: string[] = [];
  for (const p of productsRaw) {
    const isDirty = dirtyByProductId.get(p.id) ?? true;
    if (!opts.force && !isDirty) {
      skippedForCleanPhotos.push(p.reference);
    } else {
      products.push(p);
    }
  }
  if (skippedForCleanPhotos.length > 0) {
    logger.info(
      `[Microstore/PS] bulk : ${skippedForCleanPhotos.length} produit(s) sautés (photos inchangées)`,
      { references: skippedForCleanPhotos.slice(0, 10) },
    );
  }

  // Cas particulier : tous les produits ont été filtrés (photos inchangées).
  // On sort en succès sans appeler Microstore ni créer de job UI.
  if (products.length === 0) {
    return {
      success: true,
      attempted: productIds.length,
      photosUploaded: 0,
      successCount: 0,
      failedCount: 0,
      skippedProducts: skippedForCleanPhotos,
      coversPatched: 0,
      coversFailed: 0,
    };
  }

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
        microstorePhotosDirty: false,
      } as never,
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
