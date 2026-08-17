/**
 * Server actions Ankorstore back-office (reverse-engineered).
 *
 * Remplace la pile OAuth2 callback-only par des appels synchrones directs
 * au back-office https://fr.ankorstore.com. Tout est immédiat — plus de
 * table `AnkorstoreOperation`, plus de webhook, plus de polling.
 */

"use server";

import { readFile } from "node:fs/promises";
import path from "node:path";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { setSiteConfig, unsetSiteConfig } from "@/lib/site-config-write";
import { requireCurrentTenant } from "@/lib/tenant";
import { tenantALS } from "@/lib/tenant-als";
import { logger } from "@/lib/logger";
import { revalidateTag as _revalidateTag } from "next/cache";
import { emitProductEvent as _emitProductEvent } from "@/lib/product-events";

/**
 * Wrappers safe pour les fonctions Next.js qui exigent un contexte requête.
 * Dans un worker/script, on skip silencieusement l'invalidation cache/SSE.
 */
function revalidateTag(tag: string): void {
  try {
    _revalidateTag(tag, "default");
  } catch {
    /* hors requête — worker ou script */
  }
}
function emitProductEvent(evt: { type: string; productId: string }): void {
  try {
    _emitProductEvent(evt as never);
  } catch {
    /* hors requête */
  }
}
import {
  getBoSession,
  invalidateBoSession,
  primeBoCredentials,
  uploadImage,
  uploadImagesSequential,
  waitForUploadsIngestion,
  createProduct,
  updateProduct,
  readProductById,
  readProductByIdWithRetry,
  readProductByIdWithSkuFallback,
  resolveAnkorImageUrl,
  searchProducts,
  enableProducts,
  disableProducts,
  archiveProducts,
  findLinkCandidates,
  buildProductPayloadFromBjProduct,
  buildAnkorstoreBoSku,
  BoApiError,
  computeAnkorImageSyncPlan,
  type AnkorImageSnapshot,
  type AnkorImageSyncPlan,
  type BjColorInputForBo,
  type BjProductInputForBo,
  type BoProductPayload,
  type BoProductSummary,
} from "@/lib/ankorstore-bo";
import { Prisma } from "@prisma/client";
import { normalizeColorForSku, normalizeReferenceForSku } from "@/lib/ankorstore-bo/sku";
import { ankorImageBelongsToProduct } from "@/lib/ankorstore-bo/image-url-guard";
import { loadAnkorstorePricingConfig } from "@/lib/ankorstore-pricing";

async function requireAdmin() {
  // Skip silencieusement quand on est appelé hors contexte requête HTTP (workers,
  // scripts CLI, jobs background) — `getServerSession` throw "headers outside
  // request scope" dans ce cas. Le tenantId est déjà scopé par l'ALS/BDD.
  try {
    const session = await getServerSession(authOptions);
    if (session && session.user.role !== "ADMIN") throw new Error("Non autorisé");
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes("Non autorisé")) throw err;
    // ignore "headers was called outside a request scope" — worker context
  }
}

// ─────────────────────────────────────────────────────────────
// Configuration : email / mot de passe
// ─────────────────────────────────────────────────────────────

export interface AnkorstoreBoCredentialsInput {
  email: string;
  password: string;
}

/**
 * Enregistre email + mot de passe Ankorstore chiffrés en SiteConfig.
 * (Les clés sont marquées "sensibles" dans lib/encryption.ts — chiffrées automatiquement.)
 */
export async function updateAnkorstoreBoCredentials(
  input: AnkorstoreBoCredentialsInput
): Promise<{ success: boolean; error?: string }> {
  try {
    await requireAdmin();
    const email = input.email.trim();
    const password = input.password.trim();
    if (!email || !password) {
      return { success: false, error: "Email et mot de passe requis" };
    }
    await setSiteConfig("ankorstore_bo_email", email);
    await setSiteConfig("ankorstore_bo_password", password);
    // Invalide la session en cache (au cas où on avait déjà loggué avec les anciens)
    invalidateBoSession();
    revalidateTag("site-config");
    return { success: true };
  } catch (err) {
    logger.error("[ankorstore-bo] updateAnkorstoreBoCredentials", { error: err as Error });
    return { success: false, error: (err as Error).message };
  }
}

/** Efface les identifiants. */
export async function clearAnkorstoreBoCredentials(): Promise<{ success: boolean }> {
  await requireAdmin();
  await unsetSiteConfig("ankorstore_bo_email");
  await unsetSiteConfig("ankorstore_bo_password");
  invalidateBoSession();
  revalidateTag("site-config");
  return { success: true };
}

/**
 * Teste la connexion : login réel avec email/pwd fournis (sans les persister).
 * Renvoie `valid: true` si login OK. Utile pour le bouton « Vérifier » de l'UI.
 */
export async function validateAnkorstoreBoCredentials(
  input: AnkorstoreBoCredentialsInput
): Promise<{ valid: boolean; error?: string; brandName?: string }> {
  try {
    await requireAdmin();
    const tenant = await requireCurrentTenant();
    const email = input.email.trim();
    const password = input.password.trim();
    if (!email || !password) return { valid: false, error: "Email et mot de passe requis" };
    // On prime les creds en mémoire pour le tenant courant, on invalide toute
    // session cache, puis on wrap l'appel `getBoSession` dans tenantALS.run
    // pour garantir que `getCurrentTenantIdSync()` retourne bien le tenant BJ
    // au moment où `readCredentials` cherche les creds primed.
    primeBoCredentials(tenant.id, email, password);
    invalidateBoSession(tenant.id);
    try {
      const session = await tenantALS.run(tenant.id, () => getBoSession());
      return { valid: true, brandName: `Compte marque #${session.brandId}` };
    } finally {
      // Nettoie la session cache pour ne pas garder l'auth en RAM (sécurité).
      invalidateBoSession(tenant.id);
    }
  } catch (err) {
    logger.error("[ankorstore-bo] validateBoCredentials", { error: err as Error });
    return { valid: false, error: (err as Error).message };
  }
}

/** Toggle Ankorstore actif / en pause. */
export async function toggleAnkorstoreBoEnabled(
  enabled: boolean
): Promise<{ success: boolean; error?: string }> {
  try {
    await requireAdmin();
    await setSiteConfig("ankorstore_bo_enabled", enabled ? "true" : "false");
    revalidateTag("site-config");
    return { success: true };
  } catch (err) {
    return { success: false, error: (err as Error).message };
  }
}

// ─────────────────────────────────────────────────────────────
// Helper — charger produit BJ et le convertir en BjProductInputForBo
// ─────────────────────────────────────────────────────────────

/**
 * Normalise une valeur de couleur (BJ ou Ankor) pour permettre le matching
 * cross-source : supprime les accents et met en majuscules. Sert au fallback
 * de mapping variant.id quand les SKUs BJ ↔ Ankor ne coïncident pas (produit
 * renommé, SKU stale côté Ankor…).
 */
function normalizeColorKey(value: string): string {
  return value
    .normalize("NFD")
    .replace(/\p{Mn}/gu, "")
    .trim()
    .toUpperCase();
}

async function loadBjProductForBo(productId: string): Promise<BjProductInputForBo> {
  const p = await prisma.product.findUnique({
    where: { id: productId },
    select: {
      reference: true,
      name: true,
      description: true,
      status: true,
      hsCode: { select: { code: true } },
      countryIsoCode: true,
      dimensionLength: true,
      dimensionWidth: true,
      dimensionHeight: true,
      dimensionDiameter: true,
      isBestSeller: true,
      primaryColorId: true,
      compositions: {
        select: {
          percentage: true,
          composition: { select: { name: true } },
        },
      },
      colorImages: {
        select: { path: true, order: true, colorId: true },
        orderBy: { order: "asc" as const },
      },
      colors: {
        select: {
          id: true,
          saleType: true,
          disabled: true,
          unitPrice: true,
          packQuantity: true,
          stock: true,
          weight: true,
          ankorsColorNameOverride: true,
          ankorsSku: true,
          colorId: true,
          color: { select: { name: true } },
          variantSizes: {
            select: { quantity: true, size: { select: { name: true, position: true } } },
            orderBy: [{ size: { position: "asc" as const } }, { size: { name: "asc" as const } }],
          },
          images: {
            select: { path: true, order: true },
            orderBy: { order: "asc" as const },
          },
        },
        orderBy: { createdAt: "asc" as const },
      },
    },
  });

  if (!p) throw new Error(`Produit ${productId} introuvable`);

  const compositionText = p.compositions
    .map((c) => `${Number(c.percentage)}% ${c.composition.name}`)
    .join(" ");

  const dimensionsText = formatDimensions(
    Number(p.dimensionLength ?? 0),
    Number(p.dimensionWidth ?? 0),
    Number(p.dimensionHeight ?? 0)
  );

  // Colors (UNIT only pour le MVP)
  const colors: BjColorInputForBo[] = p.colors.map((c) => {
    // Images de la variante : uniques ordonnées, préférence images spécifiques → sinon photos couleur communes
    const specificImages = c.images.map((im) => im.path);
    const sharedImages = p.colorImages
      .filter((im) => im.colorId === c.colorId)
      .map((im) => im.path);
    const imagePaths = specificImages.length > 0 ? specificImages : sharedImages;
    // Taille de la variante côté BJ. Une variante UNIT n'a au plus qu'une VariantSize,
    // mais on prend la 1re par sécurité (ordre déjà stable via position/name asc).
    // Null / vide → le builder retombera sur DEFAULT_ANKOR_SIZE_NAME ("Taille unique").
    const sizeName = c.variantSizes[0]?.size?.name ?? null;
    return {
      id: c.id,
      saleType: c.saleType as "UNIT" | "PACK",
      disabled: c.disabled,
      unitPrice: Number(c.unitPrice),
      packQuantity: c.packQuantity,
      stock: c.stock,
      weight: c.weight ? Number(c.weight) : null,
      colorName: c.color?.name ?? null,
      ankorsColorNameOverride: c.ankorsColorNameOverride,
      sizeName,
      imageKeys: imagePaths as unknown as string[], // remplacés par les keys après upload
      // SKU sera pré-résolu (persisté ou fraîchement généré) par resolveAndPersistAnkorsSkus()
      // juste après cet appel — on part avec la valeur BDD actuelle.
      sku: c.ankorsSku ?? "",
    };
  });

  // Product-level image = UNE SEULE image = la première photo de la couleur
  // principale (Product.primaryColorId). Quand la cliente change de couleur
  // principale, la photo produit chez Ankor change automatiquement au prochain
  // Rafraîchir.
  //
  // Fallback si primaryColorId absent ou aucune photo pour cette couleur :
  // on prend la première image du produit tout court.
  const productImagePaths: string[] = [];
  if (p.primaryColorId) {
    const primaryImg = p.colorImages.find((im) => im.colorId === p.primaryColorId);
    if (primaryImg) productImagePaths.push(primaryImg.path);
  }
  if (productImagePaths.length === 0 && p.colorImages.length > 0) {
    productImagePaths.push(p.colorImages[0].path);
  }

  return {
    reference: p.reference,
    name: p.name,
    description: p.description || p.name,
    status: p.status as BjProductInputForBo["status"],
    hsCode: p.hsCode?.code ?? null,
    countryIsoCode: p.countryIsoCode,
    isBestSeller: p.isBestSeller,
    dimensionsText,
    compositionText,
    productImageKeys: productImagePaths, // à remplacer par keys post-upload
    colors,
  };
}

function formatDimensions(l: number, w: number, h: number): string {
  const parts = [l, w, h].filter((v) => v > 0).map((v) => `${v}`);
  return parts.length > 0 ? parts.join("x") : "";
}

/**
 * Lit une image sur le disque local depuis un dbPath (`/uploads/…`).
 * Retourne buffer + filename. Ignore les erreurs — retourne null si absent.
 */
async function readImageFromDisk(
  dbPath: string
): Promise<{ buffer: Buffer; filename: string } | null> {
  try {
    // dbPath commence par `/uploads/...` → correspond à `public/uploads/...`
    const abs = path.join(process.cwd(), "public", dbPath.replace(/^\//, ""));
    const buffer = await readFile(abs);
    const filename = path.basename(dbPath);
    return { buffer, filename };
  } catch (err) {
    logger.warn("[ankorstore-bo] image introuvable sur disque", { dbPath, err });
    return null;
  }
}

/**
 * Extrait de la réponse `readProductById` l'état images actuel chez Ankor,
 * mappé par ProductColor.id BJ via le SKU persisté (`ankorsSku`).
 *
 * - `productImageUrls` : URLs images produit-père (format `/products/images/…`)
 *   telles que renvoyées par Ankor.
 * - `variantImageUrlsByColorId` : URLs images de chaque variante Ankor,
 *   rattachées au ProductColor.id BJ correspondant (matching via SKU).
 *
 * Si `existingAnkor` est null (pas de lien confirmé — POST création ou lien
 * UUID legacy non résolu), on retourne des tableaux vides → le plan bascule
 * en "replace" partout et on upload tout comme avant.
 */
function extractAnkorCurrentImages(
  existingAnkor: BoProductSummary | null,
  enabledColors: BjColorInputForBo[],
): { productImageUrls: string[]; variantImageUrlsByColorId: Record<string, string[]> } {
  if (!existingAnkor) {
    return { productImageUrls: [], variantImageUrlsByColorId: {} };
  }
  // Garde-fou anti-contamination : filtre les URLs dont le préfixe numérique
  // ne matche pas l'ID du produit courant. Une URL orpheline peut arriver ici
  // quand une sync précédente a été polluée par le bug filters[id] (produit
  // 7302182 se retrouve avec /products/images/7302183-*.jpg). Sans ce filtre,
  // le plan de sync décide "keep" et réinjecte l'URL contaminée dans le PUT.
  const targetId = existingAnkor.id;
  const belongsToTarget = (url: string): boolean =>
    ankorImageBelongsToProduct(url, targetId);

  const rawProductImages = existingAnkor.images ?? [];
  const productImageUrls = rawProductImages.filter(belongsToTarget);
  if (productImageUrls.length !== rawProductImages.length) {
    logger.warn(
      "[ankorstore-bo] URL image produit orpheline écartée (contamination bug filters[id])",
      {
        ankorProductId: targetId,
        dropped: rawProductImages.filter((u) => !belongsToTarget(u)),
      },
    );
  }

  const skuToVariantImages = new Map<string, string[]>();
  for (const v of existingAnkor.variants ?? []) {
    if (v.sku) skuToVariantImages.set(v.sku, (v.images ?? []).filter(belongsToTarget));
  }
  const variantImageUrlsByColorId: Record<string, string[]> = {};
  for (const c of enabledColors) {
    if (!c.sku) continue;
    const urls = skuToVariantImages.get(c.sku);
    if (urls) variantImageUrlsByColorId[c.id] = urls;
  }
  return { productImageUrls, variantImageUrlsByColorId };
}

/**
 * Applique un plan de sync images à l'input BJ :
 *  1. Upload UNIQUEMENT `plan.pathsToUpload` (paths qui ont réellement changé)
 *  2. Remplace `productImageKeys` et `colors[].imageKeys` par :
 *      - URLs Ankor existantes (`/products/images/…`) pour les scopes en "keep"
 *      - keys `file-upload:…` fraîchement uploadées pour les scopes en "replace"
 *
 * Résultat : le PUT envoyé à Ankor est un mix de "conserve celle-là" +
 * "remplace par cette nouvelle" — Ankor n'accumule plus les doublons.
 */
async function applyImageSyncPlan(
  input: BjProductInputForBo,
  plan: AnkorImageSyncPlan,
): Promise<BjProductInputForBo> {
  // Upload sélectif — seulement les paths BJ marqués "replace"
  const uploadables = [] as { buffer: Buffer; filename: string; originalPath: string }[];
  for (const p of plan.pathsToUpload) {
    const img = await readImageFromDisk(p);
    if (img) uploadables.push({ ...img, originalPath: p });
  }
  const bjPathToAnkorKey = new Map<string, string>();
  if (uploadables.length > 0) {
    const results = await uploadImagesSequential(uploadables);
    await waitForUploadsIngestion();
    for (let i = 0; i < uploadables.length; i++) {
      bjPathToAnkorKey.set(uploadables[i].originalPath, results[i].key);
    }
  }

  // Image produit-père
  let productImageKeys: string[] = [];
  if (plan.productImage.action === "keep") {
    productImageKeys = plan.productImage.urls;
  } else if (plan.productImage.action === "replace") {
    productImageKeys = plan.productImage.bjPaths
      .map((p) => bjPathToAnkorKey.get(p))
      .filter(Boolean) as string[];
  }

  // Images par variante
  const colorPlanById = new Map(plan.colors.map((c) => [c.colorId, c]));
  const colors = input.colors.map((c) => {
    const cp = colorPlanById.get(c.id);
    if (!cp || cp.action === "none") return { ...c, imageKeys: [] };
    if (cp.action === "keep") return { ...c, imageKeys: cp.urls };
    return {
      ...c,
      imageKeys: cp.bjPaths.map((p) => bjPathToAnkorKey.get(p)).filter(Boolean) as string[],
    };
  });

  return { ...input, productImageKeys, colors };
}

/** Parse `Product.ankorsLastSyncSnapshot` en `AnkorImageSnapshot` (défensif). */
function parseSnapshot(raw: unknown): AnkorImageSnapshot | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  if (!("productImagePath" in r) || !("colorImagePaths" in r)) return null;
  const productImagePath =
    typeof r.productImagePath === "string" ? r.productImagePath : null;
  const colorImagePathsRaw = r.colorImagePaths;
  if (!colorImagePathsRaw || typeof colorImagePathsRaw !== "object") return null;
  const colorImagePaths: Record<string, string[]> = {};
  for (const [k, v] of Object.entries(colorImagePathsRaw as Record<string, unknown>)) {
    if (Array.isArray(v) && v.every((x) => typeof x === "string")) {
      colorImagePaths[k] = v as string[];
    }
  }
  return { productImagePath, colorImagePaths };
}

// ─────────────────────────────────────────────────────────────
// Resolution + persistance des SKU Ankor par variante
// ─────────────────────────────────────────────────────────────

/**
 * Resout le SKU final a envoyer pour chaque variante et le persiste en BDD.
 *
 * - Si ProductColor.ankorsSku est deja rempli : on le reutilise tel quel
 *   (indispensable pour que l'update Ankor reconnaisse la meme variante).
 * - Sinon : on genere un nouveau {REF}_{COULEUR}_{5 chars aleatoires} et on
 *   persiste immediatement dans ProductColor.ankorsSku.
 *
 * Modifie input.colors[].sku en place et renvoie l'input.
 */
async function resolveAndPersistAnkorsSkus(
  input: BjProductInputForBo
): Promise<BjProductInputForBo> {
  for (const c of input.colors) {
    if (c.sku && c.sku.trim().length > 0) continue;
    const colorName =
      c.ankorsColorNameOverride?.trim() || c.colorName?.trim() || "Standard";
    const fresh = buildAnkorstoreBoSku(input.reference, colorName);
    await prisma.productColor.update({
      where: { id: c.id },
      data: { ankorsSku: fresh },
    });
    c.sku = fresh;
  }
  return input;
}

/**
 * Regenere un nouveau suffixe pour les variantes designees, persiste en BDD
 * et remplace dans input.colors[].sku. Utilise apres une erreur 422
 * "SKU already assigned" pour retenter avec des suffixes frais.
 */
async function rerollSkusForColors(
  input: BjProductInputForBo,
  colorIds: Set<string>
): Promise<void> {
  for (const c of input.colors) {
    if (!colorIds.has(c.id)) continue;
    const colorName =
      c.ankorsColorNameOverride?.trim() || c.colorName?.trim() || "Standard";
    const fresh = buildAnkorstoreBoSku(input.reference, colorName);
    await prisma.productColor.update({
      where: { id: c.id },
      data: { ankorsSku: fresh },
    });
    c.sku = fresh;
  }
}

/**
 * Detecte une erreur Ankor "SKU already assigned" et renvoie la liste
 * des indices de variante impactes (0-based tels qu'ils apparaissent dans le
 * payload envoye). Renvoie null si l'erreur n'est pas ce cas.
 */
function extractSkuCollisionVariantIndexes(err: unknown): number[] | null {
  if (!(err instanceof BoApiError) || err.status !== 422 || !err.validation) return null;
  const impacted = new Set<number>();
  let matched = false;
  for (const [key, msgs] of Object.entries(err.validation.errors)) {
    const isSku = /^variants\.(\d+)\.sku$/.exec(key);
    if (!isSku) continue;
    const idx = Number(isSku[1]);
    const joined = msgs.join(" ").toLowerCase();
    if (
      joined.includes("already assigned") ||
      joined.includes("already been taken") ||
      joined.includes("deja")
    ) {
      impacted.add(idx);
      matched = true;
    }
  }
  return matched ? Array.from(impacted).sort((a, b) => a - b) : null;
}

/** Nombre max de re-rolls sur collision SKU (collision aleatoire = quasi-impossible). */
const MAX_SKU_COLLISION_RETRIES = 3;

/**
 * Wrapper createProduct + retry automatique sur collision de SKU.
 * enabledColors = les couleurs qui ont fini dans le payload, dans le meme
 * ordre que payload.variants (donc l'index i du payload = enabledColors[i]).
 */
async function createProductWithSkuRetry(
  input: BjProductInputForBo,
  buildPayload: () => BoProductPayload,
  enabledColors: BjColorInputForBo[]
): Promise<BoProductSummary> {
  let attempt = 0;
  while (true) {
    try {
      return await createProduct(buildPayload());
    } catch (err) {
      const impactedIdx = extractSkuCollisionVariantIndexes(err);
      if (!impactedIdx || attempt >= MAX_SKU_COLLISION_RETRIES) throw err;
      const colorIds = new Set(
        impactedIdx.map((i) => enabledColors[i]?.id).filter((v): v is string => !!v)
      );
      if (colorIds.size === 0) throw err;
      logger.warn(
        "[ankorstore-bo] collision SKU chez Ankor - regeneration suffixe + retry",
        {
          reference: input.reference,
          impactedColorIds: Array.from(colorIds),
          attempt: attempt + 1,
        }
      );
      await rerollSkusForColors(input, colorIds);
      attempt++;
    }
  }
}

/**
 * Wrapper updateProduct + retry automatique sur collision de SKU.
 * Meme logique que createProductWithSkuRetry mais pour un PUT.
 */
async function updateProductWithSkuRetry(
  ankorId: number,
  input: BjProductInputForBo,
  buildPayload: () => BoProductPayload,
  enabledColors: BjColorInputForBo[]
): Promise<BoProductSummary> {
  let attempt = 0;
  while (true) {
    try {
      return await updateProduct(ankorId, buildPayload());
    } catch (err) {
      const impactedIdx = extractSkuCollisionVariantIndexes(err);
      if (!impactedIdx || attempt >= MAX_SKU_COLLISION_RETRIES) throw err;
      const colorIds = new Set(
        impactedIdx.map((i) => enabledColors[i]?.id).filter((v): v is string => !!v)
      );
      if (colorIds.size === 0) throw err;
      logger.warn(
        "[ankorstore-bo] collision SKU chez Ankor (update) - regeneration + retry",
        {
          ankorId,
          reference: input.reference,
          impactedColorIds: Array.from(colorIds),
          attempt: attempt + 1,
        }
      );
      await rerollSkusForColors(input, colorIds);
      attempt++;
    }
  }
}

// ─────────────────────────────────────────────────────────────
// Publier / Mettre à jour / Rafraîchir / Archiver
// ─────────────────────────────────────────────────────────────

/**
 * Publie un produit BJ chez Ankorstore (créer ou mettre à jour).
 * Si `ankorsProductId` existe déjà (au format INT du back-office), fait un PUT.
 * Sinon POST (crée un nouveau).
 *
 * Note migration : les vieux `ankorsProductId` de l'API partenaire OAuth étaient
 * au format UUID (`1f13aa03-…`). Ces liens ne sont plus utilisables directement —
 * on les traite comme "non lié" et on essaie une recherche par référence pour
 * retrouver le produit correspondant côté back-office.
 */
export async function publishProductToAnkorstoreBo(
  productId: string
): Promise<{ success: boolean; ankorProductId?: number; error?: string }> {
  try {
    await requireAdmin();

    const existing = await prisma.product.findUnique({
      where: { id: productId },
      select: { ankorsProductId: true, reference: true, ankorsLastSyncSnapshot: true },
    });
    if (!existing) return { success: false, error: "Produit introuvable" };

    // Détecte le format d'ID : INT = nouveau back-office, autre chose = vieux UUID legacy.
    const legacyLinkedId = existing.ankorsProductId;
    const isNewFormat = legacyLinkedId ? /^\d+$/.test(legacyLinkedId) : false;

    const session = await getBoSession();
    const input = await loadBjProductForBo(productId);
    // Pré-résout les SKU AVANT toute lecture Ankor : les SKU BJ persistés
    // servent à matcher les variants Ankor lus via readProductById (pour
    // récupérer leurs images existantes et éviter les doublons).
    await resolveAndPersistAnkorsSkus(input);
    const enabledColorsRaw = input.colors.filter(
      (c) => c.saleType === "UNIT" && !c.disabled,
    );

    // Lit l'état Ankor actuel une fois (utile pour : mapping SKU→variant.id
    // pour éviter le 422, ET pour récupérer les URLs images existantes à
    // réutiliser dans le PUT au lieu de tout ré-uploader).
    //
    // Utilise `readProductByIdWithSkuFallback` car l'endpoint filters[id]
    // d'Ankor renvoie parfois le mauvais produit (bug 2026-08-15) — sans ce
    // fallback, les URLs d'images d'un AUTRE produit sont réinjectées dans le
    // PUT et le mauvais produit se retrouve avec l'image du nôtre chez Ankor.
    let existingAnkor: BoProductSummary | null = null;
    if (isNewFormat && legacyLinkedId) {
      const skuHints = enabledColorsRaw
        .map((c) => c.sku)
        .filter((s): s is string => !!s);
      existingAnkor = await readProductByIdWithSkuFallback(
        Number(legacyLinkedId),
        skuHints,
      );
    }

    // Construit le plan de sync images à partir du snapshot précédent et
    // de l'état Ankor. Sans snapshot ni état Ankor, le plan bascule en
    // "replace" partout — comportement identique à l'ancienne version.
    const ankorCurrent = extractAnkorCurrentImages(existingAnkor, enabledColorsRaw);
    const snapshot = parseSnapshot(existing.ankorsLastSyncSnapshot);
    const imagePlan = computeAnkorImageSyncPlan({
      bjProductImagePath: input.productImageKeys[0] ?? null,
      bjColors: enabledColorsRaw.map((c) => ({ colorId: c.id, imagePaths: c.imageKeys })),
      snapshot,
      ankor: ankorCurrent,
    });
    logger.info("[ankorstore-bo] image sync plan", {
      productId,
      reference: existing.reference,
      uploads: imagePlan.pathsToUpload.length,
      productImageAction: imagePlan.productImage.action,
      colorActions: imagePlan.colors.map((c) => `${c.colorId}:${c.action}`),
    });

    // Applique le plan : upload sélectif + remplacement des imageKeys par
    // un mix d'URLs Ankor existantes (keep) + de keys upload (replace).
    const inputWithKeys = await applyImageSyncPlan(input, imagePlan);

    const pricingConfig = await loadAnkorstorePricingConfig();

    // Fabrique le payload à la demande — nécessaire pour rebuilder après re-roll
    // de SKU sur collision. Filtre identique à celui du builder.
    const enabledColors = inputWithKeys.colors.filter(
      (c) => c.saleType === "UNIT" && !c.disabled
    );
    const buildPayload = (): BoProductPayload =>
      buildProductPayloadFromBjProduct(inputWithKeys, {
        brandId: session.brandId,
        pricingConfig,
      });

    let ankorProductId: number;
    if (isNewFormat && legacyLinkedId) {
      // Cas standard — lien back-office valide. On injecte les variant.id
      // connus dans le payload — sinon Ankor traite le PUT comme une
      // recréation et refuse 422 "SKU already assigned".
      //
      // Deux passages complémentaires :
      //  1) match SKU exact — cas nominal (SKU BJ = SKU Ankor).
      //  2) match par valeur de l'option "color" — indispensable quand le
      //     produit a été renommé côté BJ (nouvelle référence → nouveau SKU
      //     généré) alors qu'Ankor a gardé l'ancienne SKU. Sans ça, la PUT
      //     part sans variant.id sur cette couleur, Ankor considère « nouvelle
      //     variante » et laisse l'ancienne intacte — la case « Continuer à
      //     vendre » (inventory_policy=continue) ne se met jamais à jour.
      const skuToId = new Map<string, number>();
      // Clé combinée `${normalizedSize}|${normalizedColor}` — indispensable depuis
      // qu'on envoie la taille : sinon 3 variantes "Noir" écrasent la même entrée
      // dans le fallback et 2 d'entre elles perdent leur variant.id → Ankor
      // recrée puis rejette avec « SKU already assigned ».
      const optionsToId = new Map<string, number>();
      if (existingAnkor) {
        for (const v of existingAnkor.variants ?? []) {
          if (v.sku) skuToId.set(v.sku, v.id);
          const colorOpt = v.options.find((o) => o.name === "color")?.value;
          const sizeOpt = v.options.find((o) => o.name === "size")?.value;
          if (colorOpt) {
            const key = `${normalizeColorKey(sizeOpt ?? "")}|${normalizeColorKey(colorOpt)}`;
            optionsToId.set(key, v.id);
          }
        }
      }
      // Wrap le payload builder pour injecter l'id de variante connue chez Ankor.
      const buildPayloadWithVariantIds = (): BoProductPayload => {
        const p = buildPayload();
        p.variants = p.variants.map((v) => {
          const bySku = skuToId.get(v.sku);
          if (bySku) return { ...v, id: bySku };
          const colorOpt = v.options.find((o) => o.name === "color")?.value;
          const sizeOpt = v.options.find((o) => o.name === "size")?.value;
          if (!colorOpt) return v;
          const key = `${normalizeColorKey(sizeOpt ?? "")}|${normalizeColorKey(colorOpt)}`;
          const byOptions = optionsToId.get(key);
          return byOptions ? { ...v, id: byOptions } : v;
        });
        return p;
      };
      const updated = await updateProductWithSkuRetry(
        Number(legacyLinkedId),
        inputWithKeys,
        buildPayloadWithVariantIds,
        enabledColors
      );
      ankorProductId = updated.id;
    } else if (legacyLinkedId && !isNewFormat) {
      // Migration : ancien lien UUID → on essaie de retrouver le produit chez Ankor
      // par référence + SKU. Si trouvé, on rebranche + PUT. Sinon on POST un nouveau.
      logger.info("[ankorstore-bo] migration lien legacy UUID", {
        productId,
        legacyId: legacyLinkedId,
        reference: existing.reference,
      });
      const candidates = await findLinkCandidates(existing.reference);
      const bestMatch = candidates.find((c) => c.confidence === "high") ?? candidates[0];
      if (bestMatch) {
        const updated = await updateProductWithSkuRetry(
          bestMatch.product.id,
          inputWithKeys,
          buildPayload,
          enabledColors
        );
        ankorProductId = updated.id;
      } else {
        const created = await createProductWithSkuRetry(
          inputWithKeys,
          buildPayload,
          enabledColors
        );
        ankorProductId = created.id;
      }
    } else {
      // Pas de lien : POST création
      const created = await createProductWithSkuRetry(
        inputWithKeys,
        buildPayload,
        enabledColors
      );
      ankorProductId = created.id;
    }

    // Synchronise l'état actif/inactif chez Ankor en fonction du statut BJ.
    // - BJ ONLINE  → enable (produit visible chez les acheteuses)
    // - BJ OFFLINE → disable (produit caché du catalogue Ankor)
    // - BJ ARCHIVED → disable aussi (l'archivage effectif se fait via deleteProductFromAnkorstoreBo)
    try {
      if (input.status === "ONLINE") {
        await enableProducts([ankorProductId]);
      } else {
        await disableProducts([ankorProductId]);
      }
    } catch (visErr) {
      logger.warn("[ankorstore-bo] mass-action visibility failed (produit publié, à corriger manuellement)", {
        productId,
        ankorProductId,
        status: input.status,
        error: visErr,
      });
    }

    // Peuple ankorsProductId + ankorsVariantId
    // On passe les SKUs qu'on vient d'envoyer comme hints — si filters[id]
    // renvoie un mauvais produit, le fallback SKU trouve le bon.
    const readBack = await readProductByIdWithRetry(ankorProductId, {
      skuHints: enabledColors.map((c) => c.sku).filter((s): s is string => !!s),
    });
    await prisma.product.update({
      where: { id: productId },
      data: {
        ankorsProductId: String(ankorProductId),
        ankorsSyncRequired: false,
        ankorsLastRefreshedAt: new Date(),
        // Snapshot des paths BJ envoyés → sert au prochain publish pour
        // décider quelles images sont inchangées (keep = pas d'upload) vs
        // touchées (replace = upload + écrasement). Évite les doublons chez Ankor.
        ankorsLastSyncSnapshot: imagePlan.nextSnapshot as unknown as Prisma.InputJsonValue,
      },
    });
    if (readBack) {
      const skuToVid = new Map<string, number>();
      for (const v of readBack.variants ?? []) if (v.sku) skuToVid.set(v.sku, v.id);
      // On match sur ankorsSku persisté — c'est LA valeur qu'on vient d'envoyer,
      // pas besoin de la recomputer par nom de couleur (fragile si override changé).
      for (const c of enabledColors) {
        if (!c.sku) continue;
        const vid = skuToVid.get(c.sku);
        if (vid) {
          await prisma.productColor.update({
            where: { id: c.id },
            data: { ankorsVariantId: String(vid) },
          });
        }
      }
    }
    revalidateTag("products");
    emitProductEvent({ type: "product-updated", productId });
    return { success: true, ankorProductId };
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err);
    const errStack = err instanceof Error ? err.stack : undefined;
    logger.error("[ankorstore-bo] publishProduct", { productId, errMsg, errStack });
    return { success: false, error: (err as Error).message };
  }
}

/** Alias sémantique — pour l'admin qui pense « rafraîchir » = envoyer l'état BJ actuel chez Ankor. */
export const refreshProductOnAnkorstoreBo = publishProductToAnkorstoreBo;

/** Archive (soft-delete) un produit chez Ankor. Efface les IDs BJ. */
export async function deleteProductFromAnkorstoreBo(
  productId: string
): Promise<{ success: boolean; error?: string }> {
  try {
    await requireAdmin();
    const p = await prisma.product.findUnique({
      where: { id: productId },
      select: { ankorsProductId: true },
    });
    if (!p?.ankorsProductId) {
      return { success: false, error: "Produit pas encore publié chez Ankorstore" };
    }
    // Ignore les vieux liens au format UUID — on ne peut plus les archiver côté Ankor,
    // on se contente de nettoyer les IDs BJ.
    if (!/^\d+$/.test(p.ankorsProductId)) {
      logger.warn("[ankorstore-bo] archive skip lien UUID legacy", {
        productId,
        legacyId: p.ankorsProductId,
      });
      await prisma.product.update({
        where: { id: productId },
        data: { ankorsProductId: null, ankorsSyncRequired: false },
      });
      // Vide ankorsVariantId ET ankorsSku : un futur re-publish générera
      // un nouveau suffixe (contourne le refus « SKU already assigned » sur
      // la variante archivée côté Ankor).
      await prisma.productColor.updateMany({
        where: { productId },
        data: { ankorsVariantId: null, ankorsSku: null },
      });
      return { success: true };
    }
    await archiveProducts([Number(p.ankorsProductId)]);
    await prisma.product.update({
      where: { id: productId },
      data: { ankorsProductId: null, ankorsSyncRequired: false },
    });
    await prisma.productColor.updateMany({
      where: { productId },
      data: { ankorsVariantId: null, ankorsSku: null },
    });
    revalidateTag("products");
    emitProductEvent({ type: "product-updated", productId });
    return { success: true };
  } catch (err) {
    logger.error("[ankorstore-bo] deleteProduct", { productId, error: err as Error });
    return { success: false, error: (err as Error).message };
  }
}

/** Mise en ligne / hors ligne chez Ankor. */
export async function setProductVisibilityOnAnkorstoreBo(
  productId: string,
  enabled: boolean
): Promise<{ success: boolean; error?: string }> {
  try {
    await requireAdmin();
    const p = await prisma.product.findUnique({
      where: { id: productId },
      select: { ankorsProductId: true },
    });
    if (!p?.ankorsProductId) {
      return { success: false, error: "Produit pas encore publié chez Ankorstore" };
    }
    if (!/^\d+$/.test(p.ankorsProductId)) {
      return {
        success: false,
        error: "Lien Ankorstore obsolète (ancien format). Republie le produit pour régénérer le lien.",
      };
    }
    const id = Number(p.ankorsProductId);
    if (enabled) await enableProducts([id]);
    else await disableProducts([id]);
    revalidateTag("products");
    emitProductEvent({ type: "product-updated", productId });
    return { success: true };
  } catch (err) {
    return { success: false, error: (err as Error).message };
  }
}

// ─────────────────────────────────────────────────────────────
// Liaison manuelle
// ─────────────────────────────────────────────────────────────

export interface AnkorstoreBoLinkCandidate {
  ankorProductId: number;
  ankorProductUuid: string;
  name: string;
  link: string;
  /** Première image du produit chez Ankor (URL absolue prête à afficher), ou null. */
  imageUrl: string | null;
  variants: Array<{ id: number; sku: string; colorValue: string | null }>;
  confidence: "high" | "medium" | "low";
  matchedVariantCount: number;
}

/**
 * Aperçu d'une couleur BJ prête à être envoyée chez Ankorstore lors de la liaison.
 * Utilisé côté modale pour montrer à l'admin, avant liaison, quels SKU vont
 * apparaître chez Ankor et à quelle couleur BJ ils correspondent.
 */
export interface AnkorstoreBoLocalColorPreview {
  productColorId: string;
  colorName: string;
  hex: string | null;
  patternImage: string | null;
  /** SKU que Ankorstore verra après liaison. Suffixe `_?????` si à générer. */
  skuPreview: string;
  /** true = SKU pas encore persisté (5 chars aléatoires seront ajoutés). */
  isNewSku: boolean;
}

export interface AnkorstoreBoLinkSearchResult {
  candidates: AnkorstoreBoLinkCandidate[];
  bjReference: string;
  localColorsPreview: AnkorstoreBoLocalColorPreview[];
}

/**
 * Cherche des candidats de liaison pour un produit BJ (par sa référence).
 * Renvoie la liste triée par pertinence — l'admin choisit dans la modale.
 * Renvoie aussi les couleurs BJ actives + preview SKU pour l'affichage.
 */
export async function searchAnkorstoreBoCandidatesForBjProduct(
  bjProductId: string
): Promise<
  | ({ success: true } & AnkorstoreBoLinkSearchResult)
  | { success: false; error: string }
> {
  try {
    await requireAdmin();
    const bj = await prisma.product.findUnique({
      where: { id: bjProductId },
      select: {
        reference: true,
        colors: {
          where: { saleType: "UNIT", disabled: false },
          select: {
            id: true,
            ankorsColorNameOverride: true,
            ankorsSku: true,
            color: {
              select: { name: true, hex: true, patternImage: true },
            },
          },
          orderBy: { createdAt: "asc" as const },
        },
      },
    });
    if (!bj) return { success: false, error: "Produit BJ introuvable" };

    const refNorm = normalizeReferenceForSku(bj.reference);
    const localColorsPreview: AnkorstoreBoLocalColorPreview[] = bj.colors.map((c) => {
      const colorName =
        c.ankorsColorNameOverride?.trim() || c.color?.name?.trim() || "Standard";
      const skuPreview = c.ankorsSku
        ? c.ankorsSku
        : `${refNorm}_${normalizeColorForSku(colorName) || "COULEUR"}_?????`;
      return {
        productColorId: c.id,
        colorName: c.color?.name ?? "Sans nom",
        hex: c.color?.hex ?? null,
        patternImage: c.color?.patternImage ?? null,
        skuPreview,
        isNewSku: !c.ankorsSku,
      };
    });

    const candidates = await findLinkCandidates(bj.reference);
    return {
      success: true,
      bjReference: bj.reference,
      localColorsPreview,
      candidates: candidates.map((c) => ({
        ankorProductId: c.product.id,
        ankorProductUuid: c.product.uuid,
        name: c.product.name,
        link: c.product.link,
        imageUrl:
          resolveAnkorImageUrl(c.product.images?.[0]) ??
          resolveAnkorImageUrl(c.product.variants?.[0]?.images?.[0] ?? null),
        variants: (c.product.variants ?? []).map((v) => ({
          id: v.id,
          sku: v.sku,
          colorValue: v.options.find((o) => o.name === "color")?.value ?? null,
        })),
        confidence: c.confidence,
        matchedVariantCount: c.matchedVariantCount,
      })),
    };
  } catch (err) {
    return { success: false, error: (err as Error).message };
  }
}

/**
 * Lie un produit BJ à un produit Ankor existant.
 *
 * Séquence :
 *  1. Vérifie que le produit Ankor existe.
 *  2. Peuple `ankorsProductId` côté BJ.
 *  3. Déclenche IMMÉDIATEMENT un `publishProductToAnkorstoreBo` — qui va faire
 *     un PUT complet chez Ankor pour ÉCRASER les SKU legacy au nouveau format
 *     `A1720_DORE_CLAIR`. Après ce PUT, les variantes Ankor sont uniformes et
 *     les `ankorsVariantId` sont peuplés correctement.
 *
 * En cas d'échec du PUT, le lien produit reste posé (l'admin peut re-cliquer
 * sur « Publier » pour retenter).
 */
export async function linkBjProductToAnkorstoreBo(
  bjProductId: string,
  ankorProductId: number
): Promise<{ success: boolean; linkedVariants?: number; error?: string }> {
  try {
    await requireAdmin();

    // On récupère la référence BJ pour pouvoir mimer la recherche qui a
    // rempli la modale — l'endpoint `filters[id]=X` d'Ankor est instable
    // (peut renvoyer un autre produit ou rien pendant que ES rafraîchit),
    // alors que `query=<ref>` matche fiablement via les SKU des variantes.
    const bj = await prisma.product.findUnique({
      where: { id: bjProductId },
      select: { reference: true },
    });
    if (!bj) return { success: false, error: "Produit BJ introuvable" };

    let ankorProduct = await readProductByIdWithRetry(ankorProductId, {
      attempts: 2,
      delayMs: 800,
    });
    if (!ankorProduct && bj.reference.trim()) {
      const results = await searchProducts(bj.reference, { limit: 50 });
      ankorProduct = results.find((p) => p.id === ankorProductId) ?? null;
      if (ankorProduct) {
        logger.info(
          "[ankorstore-bo] linkBjProduct — fallback recherche par référence a résolu le produit",
          { bjProductId, ankorProductId, reference: bj.reference },
        );
      }
    }
    if (!ankorProduct) return { success: false, error: `Produit Ankor #${ankorProductId} introuvable` };

    // 1. Poser le lien produit (sans encore matcher les variantes — le publish qui suit s'en occupe).
    await prisma.product.update({
      where: { id: bjProductId },
      data: {
        ankorsProductId: String(ankorProductId),
        ankorsSyncRequired: false,
      },
    });

    // 2. Écraser les SKU côté Ankor au nouveau format en publiant l'état BJ actuel.
    //    Le PUT (update) renomme les variantes existantes chez Ankor et purge les vieux SKU.
    const publishResult = await publishProductToAnkorstoreBo(bjProductId);
    if (!publishResult.success) {
      // Le lien reste posé mais on remonte l'avertissement à l'admin.
      return {
        success: true,
        linkedVariants: 0,
        error:
          "Liaison OK mais la synchro initiale a échoué : " +
          (publishResult.error ?? "erreur inconnue") +
          " — clique sur « Publier » pour retenter.",
      };
    }

    // 3. Compter les variantes réellement liées (le publish a peuplé ankorsVariantId).
    const linked = await prisma.productColor.count({
      where: { productId: bjProductId, ankorsVariantId: { not: null } },
    });

    revalidateTag("products");
    emitProductEvent({ type: "product-updated", productId: bjProductId });
    return { success: true, linkedVariants: linked };
  } catch (err) {
    logger.error("[ankorstore-bo] linkBjProduct", { bjProductId, ankorProductId, error: err as Error });
    return { success: false, error: (err as Error).message };
  }
}

/**
 * Délie TOUS les produits BJ de leur lien Ankorstore côté BJ (aucun appel Ankor).
 * Utile pour repartir à zéro et refaire toutes les liaisons via le nouveau flow.
 */
export async function unlinkAllBjProductsFromAnkorstoreBo(): Promise<{
  success: boolean;
  productsUnlinked: number;
  variantsUnlinked: number;
  error?: string;
}> {
  try {
    await requireAdmin();
    const r1 = await prisma.product.updateMany({
      where: { ankorsProductId: { not: null } },
      data: { ankorsProductId: null, ankorsSyncRequired: false },
    });
    const r2 = await prisma.productColor.updateMany({
      where: { OR: [{ ankorsVariantId: { not: null } }, { ankorsSku: { not: null } }] },
      data: { ankorsVariantId: null, ankorsSku: null },
    });
    revalidateTag("products");
    return {
      success: true,
      productsUnlinked: r1.count,
      variantsUnlinked: r2.count,
    };
  } catch (err) {
    return {
      success: false,
      productsUnlinked: 0,
      variantsUnlinked: 0,
      error: (err as Error).message,
    };
  }
}

/** Défait la liaison BJ ↔ Ankor (n'archive PAS chez Ankor). */
export async function unlinkBjProductFromAnkorstoreBo(
  bjProductId: string
): Promise<{ success: boolean }> {
  await requireAdmin();
  await prisma.product.update({
    where: { id: bjProductId },
    data: { ankorsProductId: null, ankorsSyncRequired: false },
  });
  await prisma.productColor.updateMany({
    where: { productId: bjProductId },
    data: { ankorsVariantId: null, ankorsSku: null },
  });
  revalidateTag("products");
  emitProductEvent({ type: "product-updated", productId: bjProductId });
  return { success: true };
}

/** Ajoute juste une image test (utile pour valider config depuis Paramètres). */
export async function uploadTestImageToAnkorstoreBo(): Promise<
  { success: boolean; url?: string; error?: string }
> {
  try {
    await requireAdmin();
    // PNG 1×1 rouge (moins de 100 octets — pour tester le pipeline sans effet secondaire)
    const buf = Buffer.from(
      "89504E470D0A1A0A0000000D49484452000000010000000108020000009077 3DDE0000000C4944415478DA63F84F00000005010102A9AB19AB0000000049454E44AE426082".replace(/\s/g, ""),
      "hex"
    );
    const r = await uploadImage({ buffer: buf, filename: "test-1x1.png" });
    return { success: true, url: r.url };
  } catch (err) {
    return { success: false, error: (err as Error).message };
  }
}
