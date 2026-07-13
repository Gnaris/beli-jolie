/**
 * Ankorstore Update — Mode callback-only (kickoff + finalize).
 *
 * Met à jour un produit déjà publié sur Ankorstore (ankorsProductId connu).
 *
 *   1. Patches directs (`/product-variants/{id}/stock` + `/prices`) sont
 *      synchrones : leur HTTP response EST le résultat. On les exécute
 *      immédiatement dans kickoff.
 *   2. Mise à jour des champs produit / images via catalog-integration
 *      operation : async, le résultat arrive par webhook
 *      → {@link ankorstoreFinalizeUpdate} sauvegarde le snapshot.
 *
 * Si le diff ne comporte que des patches synchrones, kickoff retourne
 * `{ success: true, operationId: null }` (= rien à attendre).
 */

import { prisma } from "@/lib/prisma";
import { Prisma, type AnkorstoreOperation } from "@prisma/client";
import { formatAnkorstoreDescription } from "@/lib/ankorstore-description";
import {
  ankorstoreCreateCatalogOperation,
  ankorstoreAddProductsToOperation,
  ankorstoreStartOperation,
  ankorstorePatchVariantStock,
  ankorstorePatchVariantPrices,
  type AnkorstoreCatalogProductInput,
} from "@/lib/ankorstore-api-write";
import { autoLinkAnkorstoreVariants } from "@/lib/ankorstore-variant-link";
import {
  loadAnkorstorePricingConfig,
  getAnkorstorePackedPrice,
  getAnkorstoreChainedRetailPrice,
  toCents,
  type AnkorstorePricingConfig,
} from "@/lib/ankorstore-pricing";
import { buildAnkorstoreShapeProperties } from "@/lib/ankorstore-shape";
import {
  diffAnkorstoreSnapshots,
  diffIsEmpty,
  ANKORSTORE_SNAPSHOT_VERSION,
  type AnkorstoreSyncSnapshot,
  type AnkorstoreProductFieldsSnapshot,
  type AnkorstoreVariantSnapshot,
  type AnkorstoreImagesSnapshot,
  type AnkorstoreStatus,
} from "@/lib/ankorstore-sync-diff";
import {
  readCallbackStatus,
  extractFailureReason,
  fetchDetailedFailureMessage,
} from "@/lib/ankorstore-publish";
import { revalidateTag } from "next/cache";
import { logger } from "@/lib/logger";
import { emitProductEvent } from "@/lib/product-events";
import { buildMarketplaceImageUrl } from "@/lib/marketplace-image";
import { filterVariantsWithImages } from "@/lib/variant-image-coverage";
import { getCachedAnkorstoreEnabled } from "@/lib/cached-data";
import { getCurrentTenantIdSafe, getTenantBaseUrl } from "@/lib/tenant";

// ─────────────────────────────────────────────
// Public types
// ─────────────────────────────────────────────

export type AnkorstoreUpdateKickoffResult =
  | { success: true; operationId: string | null; archived: boolean }
  | { success: false; error: string };

/** Payload sauvegardé pour UPDATE — utilisé par finalize pour committer le snapshot. */
export interface AnkorstoreUpdatePayload {
  committedSnapshot: AnkorstoreSyncSnapshot;
  allVariantsOutOfStock: boolean;
  reference: string;
}

// ─────────────────────────────────────────────
// Internal types (identiques à ankorstore-publish)
// ─────────────────────────────────────────────

interface FullVariant {
  id: string;
  ankorsVariantId: string | null;
  unitPrice: number | { toString(): string };
  weight: number;
  stock: number;
  isPrimary: boolean;
  saleType: "UNIT" | "PACK";
  packQuantity: number | null;
  sku: string | null;
  variantSizes: { size: { name: string }; quantity: number }[];
  colorId: string | null;
  color: { id: string; name: string } | null;
  packLines: {
    colorId: string;
    color: { id: string; name: string };
    position: number;
    sizes: { size: { name: string }; quantity: number }[];
  }[];
  images: { path: string; order: number; colorId: string }[];
}

interface FullProduct {
  id: string;
  reference: string;
  name: string;
  description: string;
  status: string;
  primaryColorId: string | null;
  ankorsProductId: string | null;
  ankorsLastSyncSnapshot: unknown;
  dimensionLength: number | null;
  dimensionWidth: number | null;
  dimensionHeight: number | null;
  dimensionDiameter: number | null;
  dimensionCircumference: number | null;
  hsCode: { code: string } | null;
  sizeDetailsTu: string | null;
  category: {
    id: string;
    pfsCategoryId: string | null;
    pfsGender: string | null;
    pfsFamilyId: string | null;
    pfsFamilyName: string | null;
    pfsCategoryName: string | null;
  };
  colors: FullVariant[];
  colorImages: { path: string; order: number; colorId: string }[];
  compositions: {
    percentage: number | { toString(): string };
    composition: { name: string; pfsCompositionRef: string | null };
  }[];
  manufacturingCountry: { isoCode: string | null; pfsCountryRef: string | null } | null;
  season: { pfsRef: string | null } | null;
}

// ─────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────

async function loadProductFull(productId: string): Promise<FullProduct | null> {
  return prisma.product.findUnique({
    where: { id: productId },
    select: {
      id: true,
      reference: true,
      name: true,
      description: true,
      status: true,
      primaryColorId: true,
      ankorsProductId: true,
      ankorsLastSyncSnapshot: true,
      dimensionLength: true,
      dimensionWidth: true,
      dimensionHeight: true,
      dimensionDiameter: true,
      dimensionCircumference: true,
      hsCode: { select: { code: true } },
      sizeDetailsTu: true,
      category: {
        select: {
          id: true,
          pfsCategoryId: true,
          pfsGender: true,
          pfsFamilyId: true,
          pfsFamilyName: true,
          pfsCategoryName: true,
        },
      },
      colors: {
        select: {
          id: true,
          ankorsVariantId: true,
          unitPrice: true,
          weight: true,
          stock: true,
          isPrimary: true,
          saleType: true,
          packQuantity: true,
          sku: true,
          variantSizes: { select: { size: { select: { name: true } }, quantity: true } },
          colorId: true,
          color: { select: { id: true, name: true } },
          packLines: {
            select: {
              colorId: true,
              color: { select: { id: true, name: true } },
              position: true,
              sizes: {
                select: { size: { select: { name: true } }, quantity: true },
                orderBy: { size: { position: "asc" as const } },
              },
            },
            orderBy: { position: "asc" as const },
          },
          images: {
            select: { path: true, order: true, colorId: true },
            orderBy: { order: "asc" as const },
          },
        },
        orderBy: { createdAt: "asc" as const },
      },
      colorImages: {
        select: { path: true, order: true, colorId: true },
        orderBy: { order: "asc" as const },
      },
      compositions: {
        select: {
          percentage: true,
          composition: { select: { name: true, pfsCompositionRef: true } },
        },
      },
      manufacturingCountry: { select: { isoCode: true, pfsCountryRef: true } },
      season: { select: { pfsRef: true } },
    },
  }) as unknown as FullProduct | null;
}

// SKU centralisé : voir lib/ankorstore-sku.ts. Wrapper local pour les sites
// d'appel existants (snapshot + branche linked qui override avec realSku AS).
import {
  buildVariantSkus as buildVariantSkusShared,
  buildSingleVariantSku,
} from "@/lib/ankorstore-sku";

function buildVariantSku(
  product: Pick<FullProduct, "reference">,
  variant: FullVariant,
  index: number,
): string {
  return buildSingleVariantSku(product.reference, variant, index);
}

/**
 * URL envoyée à Ankorstore : passe par /api/marketplace-image qui
 * garantit une largeur ≥ 500px (upscale à la volée si nécessaire,
 * sans modifier le fichier d'origine sur disque).
 *
 * `baseUrl` doit être l'URL publique du tenant courant (ex: `https://issyma.fr`)
 * pour que le proxy accepte le path — sinon les images d'un tenant Issyma
 * seraient servies depuis `beliandjolie.com` → refus 403 (isolation multi-
 * tenant du path côté `/api/marketplace-image`).
 */
function buildPublicImageUrl(dbPath: string, baseUrl?: string): string {
  return buildMarketplaceImageUrl(dbPath, baseUrl);
}

function getPackColorLabel(variant: FullVariant): string {
  if (variant.packLines.length > 0) {
    return variant.packLines.map((pl) => pl.color?.name ?? "?").join("/");
  }
  return variant.color?.name ?? "?";
}

function getWholesalePrice(variant: FullVariant, config: AnkorstorePricingConfig): number {
  return getAnkorstorePackedPrice(
    Number(variant.unitPrice),
    variant.packQuantity,
    variant.saleType,
    config.wholesale,
  );
}

function getRetailPrice(variant: FullVariant, config: AnkorstorePricingConfig): number {
  return getAnkorstoreChainedRetailPrice(
    Number(variant.unitPrice),
    variant.packQuantity,
    variant.saleType,
    config.wholesale,
    config.retail,
  );
}

function toIntegerOrNull(value: number | null, multiplier: number): number | null {
  if (value == null) return null;
  if (!Number.isFinite(value)) return null;
  if (value <= 0) return null;
  return Math.round(value * multiplier);
}

function buildProductFieldsSnapshot(
  product: FullProduct,
  brandName: string,
  config: AnkorstorePricingConfig,
): AnkorstoreProductFieldsSnapshot {
  const safeDescription = formatAnkorstoreDescription({
    description: product.description || product.name,
    reference: product.reference,
    compositions: product.compositions.map((c) => ({
      percentage: Number(c.percentage),
      composition: {
        nameFR: c.composition.name ?? c.composition.pfsCompositionRef ?? "",
      },
    })),
    dimensionDiameter: product.dimensionDiameter,
    dimensionCircumference: product.dimensionCircumference,
  });
  const firstVariantWeight = product.colors[0]?.weight ?? null;
  return {
    externalId: product.reference,
    name: product.name,
    description: safeDescription,
    vatRate: config.vatRate,
    countryCode:
      product.manufacturingCountry?.isoCode ??
      product.manufacturingCountry?.pfsCountryRef ??
      "FR",
    unitMultiplier: 1,
    brandName,
    weightGrams: toIntegerOrNull(firstVariantWeight, 1000),
    dimensionLengthMm: toIntegerOrNull(product.dimensionLength, 10),
    dimensionWidthMm: toIntegerOrNull(product.dimensionWidth, 10),
    dimensionHeightMm: toIntegerOrNull(product.dimensionHeight, 10),
    hsCode: product.hsCode?.code?.trim() || null,
  };
}

function buildVariantSnapshot(
  product: FullProduct,
  variant: FullVariant,
  index: number,
  config: AnkorstorePricingConfig,
): AnkorstoreVariantSnapshot {
  const sku = buildVariantSku(product, variant, index);
  // ARCHIVED ou OFFLINE localement → stock forcé à 0 côté AS (produit retiré
  // de la vente). Réversible : repasser en ONLINE renverra le vrai stock au
  // prochain push. L'API publique Ankorstore n'expose pas de "désactiver",
  // donc stock 0 = seule façon propre de rendre un produit inachetable.
  const stock =
    product.status === "ARCHIVED" || product.status === "OFFLINE"
      ? 0
      : (variant.stock ?? 0);
  const colorLabel =
    variant.saleType === "PACK"
      ? getPackColorLabel(variant)
      : (variant.color?.name ?? "Couleur");
  let sizeLabel = "TU";
  if (variant.saleType === "PACK") {
    if (variant.packLines.length > 0 && variant.packLines[0].sizes.length > 0) {
      sizeLabel = variant.packLines[0].sizes[0].size.name;
    } else if (variant.variantSizes.length > 0) {
      sizeLabel = variant.variantSizes[0].size.name;
    }
  } else if (variant.variantSizes.length > 0) {
    sizeLabel = variant.variantSizes[0].size.name;
  }
  return {
    sku,
    wholesalePriceCents: toCents(getWholesalePrice(variant, config)),
    retailPriceCents: toCents(getRetailPrice(variant, config)),
    stockQty: stock,
    isAlwaysInStock: false,
    optionColor: colorLabel,
    optionSize: sizeLabel,
    optionMaterial: null,
  };
}

function buildImagesSnapshot(product: FullProduct): AnkorstoreImagesSnapshot {
  // Le snapshot suit les images de TOUTES les couleurs (pas seulement la
  // principale). Sinon, ajouter / supprimer / remplacer une image sur une
  // couleur secondaire ne produit aucun diff → la sync ne se déclenche pas,
  // et AS reste avec les anciennes images sur cette couleur (bug constaté
  // sur la couleur TEST de A405 le 15/05).
  //
  // Clé "main" pour la couleur principale (rétrocompat avec les snapshots
  // existants en BDD), colorId pour les autres couleurs.
  const primaryColorId =
    product.primaryColorId ?? product.colors[0]?.colorId ?? null;
  const out: AnkorstoreImagesSnapshot = {};

  const byColor = new Map<string, typeof product.colorImages>();
  for (const img of product.colorImages) {
    if (!byColor.has(img.colorId)) byColor.set(img.colorId, []);
    byColor.get(img.colorId)!.push(img);
  }

  for (const [colorId, imgs] of byColor.entries()) {
    const sorted = [...imgs].sort((a, b) => a.order - b.order);
    if (sorted.length === 0) continue;
    const key = colorId === primaryColorId ? "main" : colorId;
    out[key] = {};
    sorted.forEach((img, i) => {
      out[key][String(i + 1)] = img.path;
    });
  }
  return out;
}

function readPreviousSnapshot(raw: unknown): AnkorstoreSyncSnapshot | null {
  if (!raw || typeof raw !== "object") return null;
  const obj = raw as Partial<AnkorstoreSyncSnapshot>;
  if (obj.schemaVersion !== ANKORSTORE_SNAPSHOT_VERSION) return null;
  if (!obj.product || !obj.variants || !obj.images) return null;
  return obj as AnkorstoreSyncSnapshot;
}

function scaffoldEmpty(
  nextProduct: AnkorstoreProductFieldsSnapshot,
  targetStatus: AnkorstoreStatus,
): AnkorstoreSyncSnapshot {
  return {
    schemaVersion: ANKORSTORE_SNAPSHOT_VERSION,
    product: nextProduct,
    variants: {},
    images: {},
    status: targetStatus,
  };
}

// ─────────────────────────────────────────────
// Kickoff
// ─────────────────────────────────────────────

/**
 * Kick off an update. Applies direct PATCH stock/prices synchronously and,
 * if product fields/images changed, kicks off an async update operation.
 *
 * Returns:
 *   - `{ success: true, operationId: <uuid>, archived }` — webhook will finalize
 *   - `{ success: true, operationId: null, archived }`  — only sync patches were
 *     needed; snapshot already saved
 *   - `{ success: false, error }`                       — kickoff failed
 */
export async function ankorstoreKickoffUpdate(
  productId: string,
  options?: { forceFullSync?: boolean; skipRevalidation?: boolean },
): Promise<AnkorstoreUpdateKickoffResult> {
  // Kill switch : si la marketplace Ankorstore est désactivée dans Paramètres,
  // refuse immédiatement (couvre aussi les PATCH stock/prices synchrones).
  if (!(await getCachedAnkorstoreEnabled())) {
    return {
      success: false,
      error: "La marketplace Ankorstore est désactivée dans Paramètres > Marketplaces.",
    };
  }

  const product = await loadProductFull(productId);
  if (!product) return { success: false, error: "Produit introuvable en base" };
  if (!product.ankorsProductId) {
    return {
      success: false,
      error: "Produit non publié sur Ankorstore (pas de ankorsProductId)",
    };
  }

  product.colors = product.colors.filter((v) => v.saleType === "UNIT");
  if (product.colors.length === 0) {
    return {
      success: false,
      error:
        "Aucune variante à l'unité — Ankorstore n'accepte pas les packs. Ajoutez au moins une variante de type Unité pour synchroniser avec Ankorstore.",
    };
  }

  // Ignore les variantes dont la couleur n'a aucune image. Effets :
  // - une nouvelle couleur sans image n'est pas créée sur Ankorstore ;
  // - une variante déjà publiée qui a perdu ses images n'est plus diff →
  //   Ankorstore conserve son dernier état (statu quo).
  // - changer le stock d'une variante avec image n'entraîne plus le push
  //   collatéral des variantes sans image (bug constaté 2026-06-10).
  product.colors = filterVariantsWithImages(product.colors, product.colorImages);
  if (product.colors.length === 0) {
    return {
      success: false,
      error:
        "Aucune couleur n'a d'image — rien à synchroniser avec Ankorstore.",
    };
  }

  const ankorsProductId = product.ankorsProductId;

  try {
    const config = await loadAnkorstorePricingConfig();
    const shopNameInfo = await prisma.companyInfo.findFirst({ select: { shopName: true } });
    const brandName = shopNameInfo?.shopName ?? "Ma Boutique";

    // Auto-link variants by SKU if any local variant lacks ankorsVariantId
    if (product.colors.some((v) => !v.ankorsVariantId)) {
      try {
        const result = await autoLinkAnkorstoreVariants(productId);
        if (result.matchedExact + result.matchedColor > 0) {
          const reloaded = await loadProductFull(productId);
          if (reloaded) {
            product.colors = filterVariantsWithImages(
              reloaded.colors.filter((v) => v.saleType === "UNIT"),
              reloaded.colorImages,
            );
          }
        }
      } catch (err) {
        logger.error("[Ankorstore Update] Auto-link variants failed", {
          ankorsProductId,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }

    // Récupère les SKU RÉELS d'Ankorstore pour chaque ankorsVariantId lié.
    // Sans ça, on enverrait notre SKU local (ex. A485_BLANC_UNIT_2) dans
    // l'update payload — Ankorstore ne le reconnaîtrait pas et CRÉERAIT une
    // nouvelle variante au lieu de modifier celle qui existe (qui a un SKU
    // différent côté Ankorstore, ex. "A485_ Blanc"). Bug constaté 2026-05-12.
    //
    // En cas d'échec du fetch OU si une variante locale liée n'est pas
    // retrouvée côté Ankorstore, on refuse l'update : c'est plus safe que de
    // risquer de créer une variante en double avec le SKU local.
    const ankorsRealSkuById = new Map<string, string>();
    try {
      const { ankorstoreGetVariants } = await import("@/lib/ankorstore-api");
      const ankorsVariants = await ankorstoreGetVariants(ankorsProductId);
      for (const v of ankorsVariants) {
        if (v.sku) ankorsRealSkuById.set(v.id, v.sku);
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      logger.error("[Ankorstore Update] Fetch real variant SKUs failed", {
        ankorsProductId,
        error: msg,
      });
      return {
        success: false,
        error:
          "Impossible de récupérer les variantes Ankorstore pour vérifier les liaisons. " +
          "Réessayez dans quelques instants. (Détail : " + msg.slice(0, 200) + ")",
      };
    }

    // Variantes locales liées à un ankorsVariantId qui n'apparaît plus dans
    // le catalog Ankorstore actif (archivée côté AS, ou supprimée). On les
    // auto-délie en base + en mémoire → elles seront traitées comme "nouvelle
    // variante" plus bas (création côté AS si possible, ou conflit de SKU
    // que l'admin résoudra manuellement sur le dashboard AS).
    //
    // Avant : on retournait une erreur "Re-liez le produit" qui bloquait tout
    // push tant que la fiche AS n'était pas nettoyée à la main. Trop strict
    // dans le cas légitime où l'admin a archivé une variante côté AS.
    const stalLinked = product.colors.filter(
      (v) => v.ankorsVariantId && !ankorsRealSkuById.has(v.ankorsVariantId),
    );
    if (stalLinked.length > 0) {
      logger.warn("[Ankorstore Update] Variantes liées à des AS variants absents/archivés — auto-délie", {
        ankorsProductId,
        cleared: stalLinked.map((v) => ({
          bjVariantId: v.id,
          ankorsVariantId: v.ankorsVariantId,
          color: v.color?.name,
        })),
      });
      await prisma.productColor.updateMany({
        where: { id: { in: stalLinked.map((v) => v.id) } },
        data: { ankorsVariantId: null },
      });
      for (const v of stalLinked) v.ankorsVariantId = null;
    }

    // Build next snapshot
    const nextProductSnap = buildProductFieldsSnapshot(product, brandName, config);

    const nextVariantsSnap: AnkorstoreSyncSnapshot["variants"] = {};
    for (let i = 0; i < product.colors.length; i++) {
      const variant = product.colors[i];
      if (variant.ankorsVariantId) {
        nextVariantsSnap[variant.ankorsVariantId] = buildVariantSnapshot(
          product,
          variant,
          i,
          config,
        );
      }
    }
    const nextImagesSnap = buildImagesSnapshot(product);

    const allVariantsOutOfStock = product.colors.every((v) => (v.stock ?? 0) === 0);
    const targetStatus: AnkorstoreStatus =
      product.status === "ARCHIVED"
        ? "archived"
        : product.status === "ONLINE" && !allVariantsOutOfStock
          ? "active"
          : "inactive";

    const nextSnapshot: AnkorstoreSyncSnapshot = {
      schemaVersion: ANKORSTORE_SNAPSHOT_VERSION,
      product: nextProductSnap,
      variants: nextVariantsSnap,
      images: nextImagesSnap,
      status: targetStatus,
    };

    const realPrevSnapshot = readPreviousSnapshot(product.ankorsLastSyncSnapshot);
    const prevSnapshot = options?.forceFullSync ? null : realPrevSnapshot;
    const committedSnapshot: AnkorstoreSyncSnapshot = realPrevSnapshot
      ? { ...realPrevSnapshot }
      : scaffoldEmpty(nextProductSnap, targetStatus);

    const diff = diffAnkorstoreSnapshots(prevSnapshot, nextSnapshot);

    // Variantes locales sans ankorsVariantId = couleurs nouvellement ajoutées
    // après la 1re publication. `autoLinkAnkorstoreVariants` a déjà tenté de
    // les matcher par SKU et par couleur ci-dessus : si elles restent ici,
    // c'est qu'aucune jumelle n'existe encore côté AS → on doit les pousser
    // dans l'update payload pour qu'AS les crée. Pas de risque de doublon
    // puisque le matching a déjà confirmé l'absence.
    const unlinkedVariants = product.colors.filter((v) => !v.ankorsVariantId);
    const hasNewVariants = unlinkedVariants.length > 0;
    if (diffIsEmpty(diff) && !hasNewVariants) {
      logger.info("[Ankorstore Update] Aucun changement détecté", {
        ankorsProductId,
        reference: product.reference,
      });
      return { success: true, operationId: null, archived: allVariantsOutOfStock };
    }

    // Step 0: Couleurs supprimées localement → on met leur stock à 0 côté
    // Ankorstore (variante rendue inachetable) + on les purge du snapshot.
    //
    // Pourquoi pas de vraie suppression :
    //   - DELETE /product-variants/{id} renvoie 405 (méthode non supportée).
    //   - catalog-integration/operations/delete archive le PRODUIT entier
    //     (exige tous ses SKUs). Une sous-liste répond "Could not archive
    //     the following SKU(s)" (cas constaté sur A405 le 15/05).
    // Stocker 0 est la seule action atomique fiable côté variante. La cliente
    // peut archiver la variante manuellement sur le dashboard AS si elle veut
    // qu'elle disparaisse complètement.
    const variantsRemovedSucceeded: string[] = [];
    if (diff.variantsRemoved.length > 0) {
      const failures: { ankorsVariantId: string; error: string }[] = [];
      for (const r of diff.variantsRemoved) {
        if (!ankorsRealSkuById.has(r.ankorsVariantId)) {
          logger.info("[Ankorstore Update] Variante déjà absente/archivée côté AS — purge snapshot", {
            ankorsProductId,
            ankorsVariantId: r.ankorsVariantId,
          });
          variantsRemovedSucceeded.push(r.ankorsVariantId);
          continue;
        }
        try {
          await ankorstorePatchVariantStock(r.ankorsVariantId, {
            stockQuantity: 0,
            isAlwaysInStock: false,
          });
          logger.info("[Ankorstore Update] Variante mise à stock 0 (= inachetable)", {
            ankorsProductId,
            ankorsVariantId: r.ankorsVariantId,
            sku: ankorsRealSkuById.get(r.ankorsVariantId),
          });
          variantsRemovedSucceeded.push(r.ankorsVariantId);
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          logger.error("[Ankorstore Update] PATCH stock 0 échoué pour variante supprimée", {
            ankorsProductId,
            ankorsVariantId: r.ankorsVariantId,
            sku: ankorsRealSkuById.get(r.ankorsVariantId),
            error: msg,
          });
          failures.push({ ankorsVariantId: r.ankorsVariantId, error: msg });
        }
      }
      if (failures.length > 0) {
        return {
          success: false,
          error:
            "Mise à 0 de stock variante échouée côté Ankorstore : " +
            failures.map((f) => `${f.ankorsVariantId} (${f.error})`).join(", "),
        };
      }
    }

    // Purge synchrone des variantes supprimées dans le snapshot local pour
    // que le prochain diff ne re-déclenche pas une PATCH stock 0 inutile.
    for (const vid of variantsRemovedSucceeded) {
      delete committedSnapshot.variants[vid];
    }

    // Step A: Apply direct PATCHes for variant stock/prices.
    // Parallèle pour minimiser la latence (avant : séquentiel, ~4-8s pour 4 variantes).
    if (diff.variantsChanged.length > 0) {
      const patchPromises: Promise<void>[] = [];
      for (const ankorsVariantId of diff.variantsChanged) {
        const snap = nextSnapshot.variants[ankorsVariantId];
        if (!snap) continue;
        patchPromises.push(
          ankorstorePatchVariantStock(ankorsVariantId, {
            stockQuantity: snap.stockQty,
            isAlwaysInStock: snap.isAlwaysInStock,
          }).catch((err) => {
            logger.error("[Ankorstore Update] PATCH variant stock failed", {
              ankorsVariantId,
              error: err,
            });
          }),
          ankorstorePatchVariantPrices(ankorsVariantId, {
            wholesalePriceCents: snap.wholesalePriceCents,
            retailPriceCents: snap.retailPriceCents,
          }).catch((err) => {
            logger.error("[Ankorstore Update] PATCH variant prices failed", {
              ankorsVariantId,
              error: err,
            });
          }),
        );
        committedSnapshot.variants[ankorsVariantId] = snap;
      }
      await Promise.all(patchPromises);
      logger.info("[Ankorstore Update] Variant patches applied (parallel)", {
        count: diff.variantsChanged.length,
        calls: patchPromises.length,
      });
    }

    // Step B: Async catalog update operation for product fields / images /
    // nouvelles variantes. Les variantes encore non liées (hasNewVariants)
    // sont incluses dans le payload plus bas pour qu'AS les crée.
    const needsAsyncOp =
      diff.productChanged ||
      diff.imagesToUpload.length > 0 ||
      diff.imagesToDelete.length > 0 ||
      diff.statusChanged ||
      hasNewVariants;

    if (!needsAsyncOp) {
      // Only PATCHes (et/ou variant-delete) — save snapshot now and return.
      // La snapshot conserve les variantes supprimées : ankorstoreFinalizeDelete
      // les purgera quand le callback Ankorstore confirmera la suppression.
      await prisma.product.update({
        where: { id: productId },
        data: {
          ankorsLastSyncSnapshot: committedSnapshot as unknown as Prisma.InputJsonValue,
          // Push synchrone OK → on retire le drapeau « Synchro nécessaire »
          ankorsSyncRequired: false,
          ...(allVariantsOutOfStock && product.status === "ONLINE" ? { status: "OFFLINE" } : {}),
        },
      });
      if (!options?.skipRevalidation) {
        revalidateTag("products", "default");
      }
      emitProductEvent({
        type: allVariantsOutOfStock ? "PRODUCT_OFFLINE" : "PRODUCT_UPDATED",
        productId,
      });
      return {
        success: true,
        operationId: null,
        archived: allVariantsOutOfStock,
      };
    }

    // Refuse si un PUBLISH ou un REFRESH est déjà en vol pour ce produit :
    // ces flows ne doivent pas être doublés par une UPDATE parallèle sinon
    // les deux callbacks se chevauchent et laissent le produit dans un état
    // incohérent (mauvais ankorsProductId, snapshot corrompu). Cutoff 30 min
    // pour permettre la récupération d'un vrai callback perdu.
    const inflightBlocking = await prisma.ankorstoreOperation.findFirst({
      where: {
        productId,
        status: "PENDING",
        type: { in: ["PUBLISH", "REFRESH_DELETE_OLD", "REFRESH_CREATE_NEW"] },
        createdAt: { gt: new Date(Date.now() - 30 * 60 * 1000) },
      },
    });
    if (inflightBlocking) {
      return {
        success: false,
        error:
          "Une opération Ankorstore (publication/rafraîchissement) est déjà en cours sur ce produit. Patientez quelques minutes.",
      };
    }

    // Cancel any earlier pending update op for this product (une nouvelle
    // UPDATE remplace l'ancienne pour éviter les payloads périmés).
    await prisma.ankorstoreOperation.updateMany({
      where: { productId, status: "PENDING", type: "UPDATE" },
      data: { status: "CANCELLED", completedAt: new Date() },
    });

    // Build the product input for the async update operation
    const firstVariant = product.colors[0];
    const wholesalePrice = firstVariant ? getWholesalePrice(firstVariant, config) : 0;
    const retailPrice = firstVariant ? getRetailPrice(firstVariant, config) : 0;

    // Images : on les indexe par colorId pour qu'à chaque variante on associe
    // ses propres photos. Au niveau produit, on prend toutes les couleurs
    // dans l'ordre (couleur primaire d'abord).
    const imagesByColorId = new Map<string, string[]>();
    for (const img of [...product.colorImages].sort((a, b) => a.order - b.order)) {
      if (!imagesByColorId.has(img.colorId)) imagesByColorId.set(img.colorId, []);
      imagesByColorId.get(img.colorId)!.push(img.path);
    }

    // Domaine du tenant courant pour construire les URLs images envoyées à AS.
    // Sans ça, Issyma publierait des URLs `https://beliandjolie.com/...` que
    // le proxy `/api/marketplace-image` refuse en 403 (isolation multi-tenant
    // du path).
    const tenantId = await getCurrentTenantIdSafe();
    const imageBaseUrl = tenantId ? (await getTenantBaseUrl(tenantId)) ?? undefined : undefined;

    // Images niveau produit : UNIQUEMENT celles de la couleur principale.
    // Les autres couleurs ont leurs images attachées à leur variante.
    // Spec Ankorstore : `main_image` porte l'order 1 implicite, donc `images`
    // ne doit lister que les photos additionnelles (order >= 2) pour éviter
    // que la 1re photo soit dupliquée dans la galerie produit.
    const primaryColorId = product.primaryColorId ?? product.colors[0]?.colorId ?? null;
    const primaryColorPaths = primaryColorId
      ? (imagesByColorId.get(primaryColorId) ?? [])
      : [];
    const mainImage = primaryColorPaths[0]
      ? buildPublicImageUrl(primaryColorPaths[0], imageBaseUrl)
      : undefined;
    const productImages = primaryColorPaths.slice(1).map((path, idx) => ({
      order: idx + 2,
      url: buildPublicImageUrl(path, imageBaseUrl),
    }));
    // Poids en kg sans unit_code (cf. lib/ankorstore-shape.ts pour les détails).
    const weightKg = firstVariant?.weight && firstVariant.weight > 0
      ? Math.round(firstVariant.weight * 1000) / 1000
      : undefined;

    const shapeProperties = buildAnkorstoreShapeProperties(weightKg, {
      length: product.dimensionLength,
      width: product.dimensionWidth,
      height: product.dimensionHeight,
    });

    const productInput: AnkorstoreCatalogProductInput = {
      externalId: product.reference,
      name: nextProductSnap.name,
      description: nextProductSnap.description,
      ...(mainImage ? { mainImage } : {}),
      ...(productImages.length > 0 ? { images: productImages } : {}),
      currency: "EUR",
      vatRate: config.vatRate,
      unitMultiplier: 1,
      wholesalePrice,
      retailPrice,
      countryCode: nextProductSnap.countryCode,
      ...(nextProductSnap.hsCode ? { hsCode: nextProductSnap.hsCode } : {}),
      ...(shapeProperties ? { shapeProperties } : {}),
      // Variantes envoyées à AS :
      //  - liées (ankorsVariantId connu) → on utilise leur SKU réel AS pour
      //    qu'AS les mette à jour en place (sinon doublon).
      //  - non liées (nouvelle couleur ajoutée après la 1re publication) →
      //    on utilise notre SKU local, AS la crée. `autoLinkAnkorstoreVariants`
      //    a déjà confirmé qu'aucune jumelle n'existe côté AS pour cette
      //    couleur → aucun risque de doublon. Après le webhook succeeded,
      //    finalize relancera l'auto-link pour récupérer le nouvel
      //    ankorsVariantId créé par AS.
      //
      // Pour les variantes non liées, on construit d'abord la map des SKU
      // avec déduplication interne (cf. lib/ankorstore-sku.ts) — sinon deux
      // tailles d'une même couleur partagent le SKU manuel et AS refuse.
      variants: ((): AnkorstoreCatalogProductInput["variants"] => {
        const localSkuByVariantId = buildVariantSkusShared(
          product.reference,
          product.colors,
        );
        return product.colors.map((variant, i) => {
        // Utilise le SKU réel d'Ankorstore pour les variantes déjà liées
        // (sinon Ankorstore créerait une nouvelle variante au lieu de modifier
        // l'existante).
        const realSku = variant.ankorsVariantId
          ? ankorsRealSkuById.get(variant.ankorsVariantId)
          : null;
        const sku = realSku ?? localSkuByVariantId.get(variant.id) ?? buildVariantSku(product, variant, i);
        const variantWholesale = getWholesalePrice(variant, config);
        const variantRetail = getRetailPrice(variant, config);
        const colorLabel =
          variant.saleType === "PACK"
            ? getPackColorLabel(variant)
            : (variant.color?.name ?? "Couleur");
        let sizeLabel = "TU";
        if (variant.saleType === "PACK") {
          if (variant.packLines.length > 0 && variant.packLines[0].sizes.length > 0) {
            sizeLabel = variant.packLines[0].sizes[0].size.name;
          } else if (variant.variantSizes.length > 0) {
            sizeLabel = variant.variantSizes[0].size.name;
          }
        } else if (variant.variantSizes.length > 0) {
          sizeLabel = variant.variantSizes[0].size.name;
        }
        const variantColorId = variant.colorId ?? "";
        const paths = imagesByColorId.get(variantColorId) ?? [];
        const variantImages = paths.map((p, idx) => ({
          order: idx + 1,
          url: buildPublicImageUrl(p, imageBaseUrl),
        }));
        return {
          sku,
          ian: null,
          // ARCHIVED ou OFFLINE localement → stock 0 forcé (retiré de la
          // vente). Réversible : repasser en ONLINE renverra le vrai stock
          // au prochain push.
          stockQuantity:
            product.status === "ARCHIVED" || product.status === "OFFLINE"
              ? 0
              : (variant.stock ?? 0),
          isAlwaysInStock: false,
          wholesalePrice: variantWholesale,
          retailPrice: variantRetail,
          originalWholesalePrice: variantWholesale,
          // L'option `material` n'est PAS envoyee : Ankorstore n'expose pas
          // ce champ via leur API publique (confirme par inspection de la
          // reponse GET). La section "Composition" du backoffice AS est
          // un champ proprietaire qui se saisit manuellement chez eux.
          // La composition est deja presente dans la description envoyee.
          options: [
            { name: "color" as const, value: colorLabel },
            { name: "size" as const, value: sizeLabel },
          ],
          ...(variantImages.length > 0 ? { images: variantImages } : {}),
        };
        });
      })(),
    };

    // Reflect the async pieces (images, product fields, status) into the
    // committed snapshot — finalize will commit on success.
    // On purge aussi les variantes supprimées : sinon le finalize UPDATE
    // réécrirait la snapshot avec ces variantes, annulant le travail de
    // ankorstoreFinalizeDelete (l'ordre des deux callbacks n'est pas garanti).
    const removedVariantIdSet = new Set(
      diff.variantsRemoved.map((v) => v.ankorsVariantId),
    );
    const cleanedVariants: AnkorstoreSyncSnapshot["variants"] = {};
    for (const [vid, snap] of Object.entries(committedSnapshot.variants)) {
      if (!removedVariantIdSet.has(vid)) cleanedVariants[vid] = snap;
    }
    const committedAfterAsync: AnkorstoreSyncSnapshot = {
      ...committedSnapshot,
      variants: cleanedVariants,
      product: nextProductSnap,
      images: nextImagesSnap,
      status: targetStatus,
    };

    // Choix du type d'opération AS :
    //   - "update" : modifie en place les variantes déjà liées. Ne crée PAS
    //     de nouvelles variantes (les SKU inconnus du payload sont ignorés
    //     silencieusement).
    //   - "import" : crée OU met à jour (superset). Nécessaire quand on a
    //     des variantes locales sans `ankorsVariantId` à créer côté AS.
    //
    // On choisit dynamiquement : "import" dès qu'il y a au moins une
    // variante locale non liée à pousser. Sinon "update" (plus léger côté AS).
    const opType: "import" | "update" = hasNewVariants ? "import" : "update";
    const { operationId } = await ankorstoreCreateCatalogOperation(opType);
    logger.info("[Ankorstore Update] Creating catalog operation", {
      operationId,
      opType,
      productId,
      reference: product.reference,
      hasNewVariants,
      unlinkedVariantCount: unlinkedVariants.length,
    });
    const addResp = await ankorstoreAddProductsToOperation(operationId, [productInput]);
    if (addResp.totalProductsCount === 0) {
      throw new Error("Ankorstore n'a accepté aucun produit (payload silencieusement rejeté).");
    }

    const payload: AnkorstoreUpdatePayload = {
      committedSnapshot: committedAfterAsync,
      allVariantsOutOfStock,
      reference: product.reference,
    };

    // Persister l'op en PENDING AVANT le start — sinon le webhook peut arriver
    // avant l'insert et être ignoré (« unknown_operation »).
    logger.info("[Ankorstore Update] Persisting UPDATE row", {
      operationId,
      productId,
      reference: product.reference,
    });
    const { persistAnkorstoreOperation } = await import("@/lib/ankorstore-persist");
    await persistAnkorstoreOperation({
      id: operationId,
      productId,
      type: "UPDATE",
      payload: payload as unknown as Prisma.InputJsonValue,
      context: "Ankorstore Update",
    });

    await ankorstoreStartOperation(operationId);

    logger.info("[Ankorstore Update] Kicked off", {
      operationId,
      productId,
      reference: product.reference,
    });

    return { success: true, operationId, archived: allVariantsOutOfStock };
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    logger.error("[Ankorstore Update] Kickoff failed", { productId, error: err });
    return { success: false, error: errorMsg };
  }
}

// ─────────────────────────────────────────────
// Finalize (called by webhook)
// ─────────────────────────────────────────────

/**
 * Finalize an update operation after Ankorstore's callback. Saves the
 * snapshot to product.ankorsLastSyncSnapshot on success.
 */
export async function ankorstoreFinalizeUpdate(
  op: AnkorstoreOperation,
  callbackPayload: unknown,
): Promise<void> {
  if (op.status !== "PENDING") {
    logger.info("[Ankorstore Update] Finalize skipped — already terminal", {
      operationId: op.id,
      status: op.status,
    });
    return;
  }

  const callbackStatus = readCallbackStatus(callbackPayload);
  const payload = op.payload as unknown as AnkorstoreUpdatePayload;

  if (callbackStatus === "failed" || callbackStatus === "skipped") {
    const detailed = await fetchDetailedFailureMessage(op.id);
    const errorMessage = detailed ?? extractFailureReason(callbackPayload);
    await prisma.ankorstoreOperation.update({
      where: { id: op.id },
      data: {
        status: "FAILED",
        callbackPayload: callbackPayload as Prisma.InputJsonValue,
        errorMessage,
        completedAt: new Date(),
      },
    });
    logger.warn("[Ankorstore Update] Operation failed", {
      operationId: op.id,
      productId: op.productId,
      status: callbackStatus,
      errorMessage,
    });
    return;
  }

  // succeeded or partially_failed — commit the snapshot
  try {
    const dbUpdate: Record<string, unknown> = {
      ankorsLastSyncSnapshot: payload.committedSnapshot as unknown as Prisma.InputJsonValue,
      // Callback Ankorstore OK → on retire le drapeau « Synchro nécessaire »
      ankorsSyncRequired: false,
    };
    // Set OFFLINE if all variants out of stock and currently ONLINE
    const localProduct = await prisma.product.findUnique({
      where: { id: op.productId },
      select: { status: true },
    });
    if (payload.allVariantsOutOfStock && localProduct?.status === "ONLINE") {
      dbUpdate.status = "OFFLINE";
    }

    await prisma.$transaction([
      prisma.product.update({
        where: { id: op.productId },
        data: dbUpdate,
      }),
      prisma.ankorstoreOperation.update({
        where: { id: op.id },
        data: {
          status: callbackStatus === "succeeded" ? "SUCCEEDED" : "PARTIALLY_FAILED",
          callbackPayload: callbackPayload as Prisma.InputJsonValue,
          completedAt: new Date(),
        },
      }),
    ]);

    // Récupère les ankorsVariantId des couleurs nouvellement créées côté AS
    // (variantes qui n'avaient pas de jumelle au moment du kickoff). Sans ça,
    // la prochaine modif de stock/prix ne saurait pas vers où PATCH-er.
    try {
      const link = await autoLinkAnkorstoreVariants(op.productId);
      if (link.matchedExact + link.matchedColor > 0) {
        logger.info("[Ankorstore Update] Auto-linked new variants after finalize", {
          operationId: op.id,
          productId: op.productId,
          matchedExact: link.matchedExact,
          matchedColor: link.matchedColor,
        });
      }
    } catch (err) {
      logger.error("[Ankorstore Update] Auto-link post-finalize failed", {
        operationId: op.id,
        productId: op.productId,
        error: err,
      });
    }

    revalidateTag("products", "default");
    emitProductEvent({
      type: payload.allVariantsOutOfStock ? "PRODUCT_OFFLINE" : "PRODUCT_UPDATED",
      productId: op.productId,
    });

    logger.info("[Ankorstore Update] Finalized", {
      operationId: op.id,
      productId: op.productId,
    });
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    await prisma.ankorstoreOperation.update({
      where: { id: op.id },
      data: {
        status: "FAILED",
        callbackPayload: callbackPayload as Prisma.InputJsonValue,
        errorMessage: errorMsg,
        completedAt: new Date(),
      },
    });
    logger.error("[Ankorstore Update] Finalize error", {
      operationId: op.id,
      productId: op.productId,
      error: err,
    });
  }
}
