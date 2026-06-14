/**
 * Faire Publish — POST /products + PATCH inventory + sauvegarde des IDs.
 *
 * Chaîne synchrone (Faire n'a pas de mode callback async pour la création) :
 *   1. loadProductFull       — charge le produit BJ avec ses couleurs/images
 *   2. validate              — utilise faire-shape pour pré-rejeter
 *   3. POST /products        — crée en DRAFT par défaut
 *   4. lit la réponse        — récupère `id` produit + `id` de chaque variante
 *   5. mappe en BDD          — faireProductId + ProductColor.faireVariantId
 *   6. PATCH inventory bulk  — pousse le stock réel (le available_quantity
 *                              envoyé dans le POST initial est ignoré)
 *   7. sauve le snapshot     — pour permettre les diffs incrémentaux ensuite
 *
 * Note proxy images : Faire exige JPEG/PNG ≥ 1000×1000. Le proxy actuel
 * `/api/marketplace-image` renvoie du WebP tel quel. L'extension JPEG du
 * proxy (`?format=jpeg`) sera ajoutée en étape 3.B — pour le moment le helper
 * d'URL annote le param mais le proxy l'ignorera silencieusement (= le test
 * réel reste à faire en 3.B).
 */

import { prisma } from "@/lib/prisma";
import { Prisma } from "@prisma/client";
import { revalidateTag } from "next/cache";
import { logger } from "@/lib/logger";
import { faireFetch } from "@/lib/faire-api";
import { buildFaireVariantSkus } from "@/lib/faire-sku";
import {
  applyFaireMarkupWithClamp,
  loadMarketplaceMarkupConfigs,
  type MarkupConfig,
} from "@/lib/marketplace-pricing";
import { buildFaireDescription } from "@/lib/faire-description";
import {
  validateFaireProductShape,
  type FaireShapeValidation,
} from "@/lib/faire-shape";
import {
  faireUpdateInventory,
  type FaireInventoryUpdate,
} from "@/lib/faire-inventory";
import {
  FAIRE_SNAPSHOT_VERSION,
  type FaireSyncSnapshot,
  type FaireVariantSnapshot,
} from "@/lib/faire-sync-diff";
import { buildFaireImageUrl } from "@/lib/marketplace-image";

// ─────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────

export type FairePublishResult =
  | {
      success: true;
      faireProductId: string;
      variantMap: { bjVariantId: string; sku: string; faireVariantId: string | null }[];
      warnings: string[];
    }
  | { success: false; error: string; details?: FaireShapeValidation };

interface FullVariant {
  id: string;
  unitPrice: Prisma.Decimal | number;
  weight: number;
  stock: number;
  isPrimary: boolean;
  saleType: "UNIT" | "PACK";
  packQuantity: number | null;
  colorId: string | null;
  color: { id: string; name: string } | null;
  variantSizes: { size: { name: string }; quantity: number }[];
  packLines: {
    colorId: string;
    color: { id: string; name: string };
    position: number;
    sizes: { size: { name: string }; quantity: number }[];
  }[];
}

interface FullProduct {
  id: string;
  reference: string;
  name: string;
  description: string;
  status: string;
  primaryColorId: string | null;
  hsCode: { code: string } | null;
  category: {
    id: string;
    faireTaxonomyId: string | null;
  } | null;
  colors: FullVariant[];
  colorImages: { path: string; order: number; colorId: string }[];
  compositions: {
    percentage: Prisma.Decimal | number;
    composition: { name: string };
  }[];
  manufacturingCountry: { isoCode: string | null } | null;
}

// ─────────────────────────────────────────────
// Loading
// ─────────────────────────────────────────────

export async function loadFaireProductFull(productId: string): Promise<FullProduct | null> {
  return prisma.product.findUnique({
    where: { id: productId },
    select: {
      id: true,
      reference: true,
      name: true,
      description: true,
      status: true,
      primaryColorId: true,
      hsCode: { select: { code: true } },
      category: {
        select: {
          id: true,
          faireTaxonomyId: true,
        },
      },
      colors: {
        select: {
          id: true,
          unitPrice: true,
          weight: true,
          stock: true,
          isPrimary: true,
          saleType: true,
          packQuantity: true,
          colorId: true,
          color: { select: { id: true, name: true } },
          variantSizes: { select: { size: { select: { name: true } }, quantity: true } },
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
          composition: { select: { name: true } },
        },
      },
      manufacturingCountry: { select: { isoCode: true } },
    },
  }) as unknown as FullProduct | null;
}

// ─────────────────────────────────────────────
// Pricing / image helpers
// ─────────────────────────────────────────────

function getVariantUnitPrice(v: FullVariant): number {
  return Number(v.unitPrice);
}

/**
 * Prix wholesale + retail à envoyer à Faire pour une variante donnée.
 * Pour les PACK, le markup s'applique au prix unitaire (total / packQuantity),
 * puis ×packQuantity pour reconstituer le total. C'est la même règle que les
 * autres marketplaces (cf. `lib/marketplace-pricing.ts` doc PACK).
 */
function getFaireVariantPrices(
  v: FullVariant,
  wholesaleConfig: MarkupConfig,
  retailConfig: MarkupConfig,
): { wholesaleCents: number; retailCents: number } {
  let basePrice = getVariantUnitPrice(v);
  if (v.saleType === "PACK" && v.packQuantity && v.packQuantity > 0) {
    basePrice = basePrice / v.packQuantity;
  }
  const { wholesale, retail } = applyFaireMarkupWithClamp(
    basePrice,
    wholesaleConfig,
    retailConfig,
  );

  let wholesaleFinal = wholesale;
  let retailFinal = retail;
  if (v.saleType === "PACK" && v.packQuantity && v.packQuantity > 0) {
    wholesaleFinal = wholesale * v.packQuantity;
    retailFinal = retail * v.packQuantity;
  }

  return {
    wholesaleCents: Math.round(wholesaleFinal * 100),
    retailCents: Math.round(retailFinal * 100),
  };
}

function buildImagesByColorId(
  colorImages: { path: string; order: number; colorId: string }[],
): Map<string, string[]> {
  const map = new Map<string, string[]>();
  const sorted = [...colorImages].sort((a, b) => a.order - b.order);
  for (const img of sorted) {
    if (!map.has(img.colorId)) map.set(img.colorId, []);
    map.get(img.colorId)!.push(img.path);
  }
  return map;
}

function packColorLabel(v: FullVariant): string {
  if (v.packLines.length > 0) {
    return v.packLines.map((pl) => pl.color?.name ?? "?").join("/");
  }
  return v.color?.name ?? "?";
}

function effectiveStock(v: FullVariant, productStatus: string): number {
  if (productStatus === "ARCHIVED") return 0;
  return v.stock ?? 0;
}

// ─────────────────────────────────────────────
// Payload builder
// ─────────────────────────────────────────────

export interface FairePublishContext {
  taxonomyTypeId: string;
  /** Code SH brut (ex : "7117.19.00"). Posé en `tariff_code` sur chaque variante. */
  tariffCode: string | null;
  /** Pays alpha-2 ISO (ex : "CN", "FR"). Envoyé en `made_in_country`. */
  countryAlpha2: string;
  /** Description finale (description produit + composition + code SH automatiques). */
  description: string;
  countryUsedFallback: boolean;
}

interface FaireVariantPayload {
  bjVariantId: string;
  sku: string;
  payload: {
    /** Stable per BJ ProductColor — réutilisé sur retry (idempotence Faire). */
    idempotence_token: string;
    sku: string;
    name: string;
    wholesale_price_cents: number;
    retail_price_cents: number;
    available_quantity: number;
    active: boolean;
    options: { name: string; value: string }[];
    images?: { url: string }[];
    measurements?: {
      weight: number;
      mass_unit: "GRAMS";
    };
    /** Code SH douanier (ex : "7117.19.00"). Faire le veut sur la variante. */
    tariff_code?: string;
    /**
     * Prix par région. Pour éviter que Faire crée des prix USD/USA par défaut,
     * on envoie explicitement les prix EUR/Union européenne sur chaque variante.
     * Tous les variants doivent avoir des prices avec les MÊMES geo_constraints.
     */
    prices?: {
      geo_constraint: { country_group: "EUROPEAN_UNION" };
      wholesale_price: { amount_minor: number; currency: "EUR" };
      retail_price: { amount_minor: number; currency: "EUR" };
    }[];
    /** Quantité par carton (>0). Pour vente à l'unité, 1. */
    unit_multiplier?: number;
  };
}

export function buildFaireProductPayload(
  product: FullProduct,
  ctx: FairePublishContext,
  wholesaleConfig: MarkupConfig,
  retailConfig: MarkupConfig,
  lifecycleState: "DRAFT" | "PUBLISHED" = "DRAFT",
): {
  body: Record<string, unknown>;
  variants: FaireVariantPayload[];
  optionValues: string[];
} {
  const imagesByColorId = buildImagesByColorId(product.colorImages);
  const skuByVariantId = buildFaireVariantSkus(
    product.reference,
    product.colors.map((c) => ({
      id: c.id,
      saleType: c.saleType,
      color: c.color,
    })),
  );

  const variants: FaireVariantPayload[] = [];
  const optionValuesSet = new Set<string>();

  for (let i = 0; i < product.colors.length; i++) {
    const v = product.colors[i];
    const sku = skuByVariantId.get(v.id) ?? v.id;
    const prices = getFaireVariantPrices(v, wholesaleConfig, retailConfig);
    const stock = effectiveStock(v, product.status);
    const colorLabel = v.saleType === "PACK" ? packColorLabel(v) : v.color?.name ?? "Couleur";
    optionValuesSet.add(colorLabel);

    const imgPaths = imagesByColorId.get(v.colorId ?? "") ?? [];
    const images = imgPaths.length > 0
      ? imgPaths.slice(0, 5).map((p) => ({ url: buildFaireImageUrl(p) }))
      : undefined;

    const measurements = v.weight > 0
      ? { weight: Math.round(v.weight * 1000), mass_unit: "GRAMS" as const }
      : undefined;

    const variantName =
      v.saleType === "PACK" && v.packQuantity
        ? `${colorLabel} (pack ${v.packQuantity})`
        : colorLabel;

    variants.push({
      bjVariantId: v.id,
      sku,
      payload: {
        // Token déterministe basé sur l'ID BJ de la variante + version schema.
        idempotence_token: `bj-var-${v.id}-v2`,
        sku,
        name: variantName,
        wholesale_price_cents: prices.wholesaleCents,
        retail_price_cents: prices.retailCents,
        available_quantity: stock,
        active: stock > 0 || product.status !== "ARCHIVED",
        options: [{ name: "Color", value: colorLabel }],
        ...(images ? { images } : {}),
        ...(measurements ? { measurements } : {}),
        ...(ctx.tariffCode ? { tariff_code: ctx.tariffCode } : {}),
        // Quantité par carton — Faire impose > 0 dès qu'on envoie `prices`.
        // 1 = vente à l'unité (pas d'emballage par carton).
        unit_multiplier: 1,
        // Prix EUR explicite. Sinon Faire crée des prix USD/USA par défaut.
        // Format obligatoire `amount_minor` (pas `amount_cents`).
        prices: [
          {
            geo_constraint: { country_group: "EUROPEAN_UNION" as const },
            wholesale_price: { amount_minor: prices.wholesaleCents, currency: "EUR" as const },
            retail_price: { amount_minor: prices.retailCents, currency: "EUR" as const },
          },
        ],
      },
    });
  }

  // Prix produit racine = ceux de la première variante (Faire exige des
  // wholesale_price_cents / retail_price_cents au niveau produit).
  const rootPrices = variants[0]
    ? {
        wholesale_price_cents: variants[0].payload.wholesale_price_cents,
        retail_price_cents: variants[0].payload.retail_price_cents,
      }
    : { wholesale_price_cents: 0, retail_price_cents: 0 };

  // Note : `sale_state` est read-only côté Faire — c'est Faire qui bascule
  // automatiquement entre FOR_SALE et SALES_PAUSED selon le stock vs MOQ.
  // Tenter de l'envoyer renvoie HTTP 400 "product field 'sale_state' is read-only".
  // Note : `idempotence_token` est obligatoire à la création — utilisé pour
  // éviter les doublons en cas de retry. Stable par produit BJ.
  // Token incluant un suffixe schema-version : si on change le format du
  // payload, on bumpe ce suffixe pour ne pas tomber sur un cache d'erreur
  // d'une ancienne tentative.
  const body: Record<string, unknown> = {
    idempotence_token: `bj-product-${product.id}-v2`,
    name: product.name,
    description: ctx.description,
    short_description: ctx.description.slice(0, 200),
    lifecycle_state: lifecycleState,
    taxonomy_type: { id: ctx.taxonomyTypeId },
    made_in_country: ctx.countryAlpha2,
    minimum_order_quantity: 1,
    per_style_minimum_order_quantity: 1,
    // unit_multiplier = 1 obligatoire (>0). Représente la "quantité par carton" :
    // ici on vend à l'unité (pas par carton), donc 1.
    unit_multiplier: 1,
    variant_option_sets: [
      { name: "Color", values: Array.from(optionValuesSet) },
    ],
    variants: variants.map((v) => v.payload),
    ...rootPrices,
  };

  return { body, variants, optionValues: Array.from(optionValuesSet) };
}

// ─────────────────────────────────────────────
// Snapshot builder (pour faire-sync-diff)
// ─────────────────────────────────────────────

export function buildFaireSnapshot(
  product: FullProduct,
  ctx: FairePublishContext,
  variants: FaireVariantPayload[],
  lifecycleState: "DRAFT" | "PUBLISHED" | "UNPUBLISHED",
): FaireSyncSnapshot {
  const variantSnapshot: Record<string, FaireVariantSnapshot> = {};
  for (const v of variants) {
    const p = v.payload;
    variantSnapshot[v.sku] = {
      sku: v.sku,
      wholesalePriceCents: p.wholesale_price_cents,
      retailPriceCents: p.retail_price_cents,
      availableQuantity: p.available_quantity,
      active: p.active,
      colorOption: p.options.find((o) => o.name === "Color")?.value ?? "",
      images: (p.images ?? []).map((i) => i.url),
      weightGrams: p.measurements?.weight ?? null,
      tariffCode: p.tariff_code ?? null,
    };
  }
  return {
    schemaVersion: FAIRE_SNAPSHOT_VERSION,
    product: {
      name: product.name,
      shortDescription: ctx.description.slice(0, 200),
      description: ctx.description,
      taxonomyTypeId: ctx.taxonomyTypeId,
      countryAlpha2: ctx.countryAlpha2,
      minimumOrderQuantity: 1,
      perStyleMinimumOrderQuantity: 1,
    },
    variants: variantSnapshot,
    lifecycleState,
  };
}

// ─────────────────────────────────────────────
// Validation prep — résout taxonomyId / tariffCode / country / description
// ─────────────────────────────────────────────

export function buildPublishContext(
  product: Pick<FullProduct, "category" | "hsCode" | "manufacturingCountry" | "compositions" | "description">,
): {
  ok: boolean;
  ctx?: FairePublishContext;
  reason?: string;
} {
  const taxonomyTypeId = product.category?.faireTaxonomyId ?? null;
  if (!taxonomyTypeId) {
    return {
      ok: false,
      reason: "La catégorie du produit n'a pas de mapping Faire (taxonomy_type). " +
        "Renseigner « Faire » sur la catégorie dans Admin > Catégories.",
    };
  }

  // Faire veut le code SH sur la VARIANTE en `tariff_code` (champ documenté
  // par l'IA Faire en juin 2026). Plus de format dédié — on envoie le `code`
  // brut tel que saisi par l'admin (qui peut déjà mettre les points si elle
  // veut, ex : "7117.19.00").
  const tariffCode = product.hsCode?.code?.trim() || null;

  // Faire veut le pays en alpha-2 dans `made_in_country` (ex : "CN", "FR").
  // L'isoCode en BDD est déjà alpha-2 — pas de conversion à faire.
  const rawAlpha2 = product.manufacturingCountry?.isoCode?.trim().toUpperCase() || null;
  const countryAlpha2 = rawAlpha2 ?? "CN"; // fallback raisonnable pour catalogue made-in-China
  const countryUsedFallback = rawAlpha2 == null;

  // Description = description produit + composition (toujours) + code SH (si rempli)
  // appendus automatiquement. Faire n'expose pas de champ structuré pour ces
  // infos visibles côté acheteuse, donc tout passe par la description.
  const description = buildFaireDescription(
    product.description ?? "",
    product.compositions.map((c) => ({
      name: c.composition.name,
      percentage: Number(c.percentage),
    })),
    tariffCode,
  );

  return {
    ok: true,
    ctx: {
      taxonomyTypeId,
      tariffCode,
      countryAlpha2,
      description,
      countryUsedFallback,
    },
  };
}

// ─────────────────────────────────────────────
// Main entry
// ─────────────────────────────────────────────

export async function fairePublishProduct(
  productId: string,
  options: { lifecycleState?: "DRAFT" | "PUBLISHED" } = {},
): Promise<FairePublishResult> {
  const product = await loadFaireProductFull(productId);
  if (!product) {
    return { success: false, error: "Produit introuvable." };
  }

  const ctxResult = buildPublishContext(product);
  if (!ctxResult.ok || !ctxResult.ctx) {
    return { success: false, error: ctxResult.reason ?? "Contexte Faire invalide." };
  }
  const ctx = ctxResult.ctx;

  const configs = await loadMarketplaceMarkupConfigs();
  const lifecycleState = options.lifecycleState ?? "DRAFT";
  const { body, variants } = buildFaireProductPayload(
    product,
    ctx,
    configs.faireWholesale,
    configs.faireRetail,
    lifecycleState,
  );

  // Validation locale (rejet rapide avant l'aller-retour HTTP).
  const validation = validateFaireProductShape({
    name: String(body.name),
    description: String(body.description ?? ""),
    taxonomyTypeId: ctx.taxonomyTypeId,
    wholesalePriceCents: Number(body.wholesale_price_cents),
    retailPriceCents: Number(body.retail_price_cents),
    countryAlpha2: ctx.countryAlpha2,
    tariffCode: ctx.tariffCode,
    productImagesCount: 0,
    variants: variants.map((v) => ({
      sku: v.sku,
      wholesalePriceCents: v.payload.wholesale_price_cents,
      retailPriceCents: v.payload.retail_price_cents,
      imagesCount: v.payload.images?.length ?? 0,
    })),
  });

  if (!validation.ok) {
    return {
      success: false,
      error: validation.errors[0] ?? "Produit invalide pour Faire.",
      details: validation,
    };
  }

  // POST /products
  let faireProductId: string;
  let createdVariants: { id: string; sku: string }[] = [];
  try {
    const res = await faireFetch(`/products`, {
      method: "POST",
      headers: { "Content-Type": "application/json; charset=utf-8" },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      const text = await res.text().catch(() => "");
      logger.error("[Faire Publish] POST failed", {
        productId,
        status: res.status,
        body: text.slice(0, 400),
      });
      return {
        success: false,
        error: `Faire a refusé la création (HTTP ${res.status}).`,
      };
    }

    const data = (await res.json()) as {
      id?: string;
      lifecycle_state?: string;
      variants?: { id?: string; sku?: string }[];
    };

    if (!data.id) {
      return { success: false, error: "Réponse Faire sans ID produit." };
    }
    if (data.lifecycle_state === "DELETED") {
      logger.error("[Faire Publish] Faire a renvoyé DELETED", { productId, data });
      return {
        success: false,
        error: "Faire a accepté puis supprimé le produit (champ inconnu ?). Vérifier les logs.",
      };
    }
    faireProductId = data.id;
    createdVariants = (data.variants ?? [])
      .filter((v): v is { id: string; sku: string } => !!v.id && !!v.sku);
  } catch (err) {
    logger.error("[Faire Publish] POST threw", { productId, error: String(err) });
    return {
      success: false,
      error: err instanceof Error ? err.message : "Erreur réseau Faire.",
    };
  }

  // Mappage variantes BJ ↔ Faire via SKU.
  const variantMap: { bjVariantId: string; sku: string; faireVariantId: string | null }[] =
    variants.map((v) => ({
      bjVariantId: v.bjVariantId,
      sku: v.sku,
      faireVariantId: createdVariants.find((cv) => cv.sku === v.sku)?.id ?? null,
    }));

  // Sauvegarde en BDD.
  const snapshot = buildFaireSnapshot(
    product,
    ctx,
    variants,
    lifecycleState,
  );

  try {
    await prisma.$transaction([
      prisma.product.update({
        where: { id: productId },
        data: {
          faireProductId,
          faireSyncRequired: false,
          faireLastSyncSnapshot: snapshot as unknown as Prisma.JsonObject,
        },
      }),
      ...variantMap
        .filter((v) => v.faireVariantId)
        .map((v) =>
          prisma.productColor.update({
            where: { id: v.bjVariantId },
            data: { faireVariantId: v.faireVariantId! },
          }),
        ),
    ]);
  } catch (err) {
    logger.error("[Faire Publish] BDD save failed", {
      productId,
      faireProductId,
      error: String(err),
    });
    return {
      success: false,
      error: "Produit créé chez Faire mais sauvegarde locale échouée.",
    };
  }

  // PATCH inventory pour pousser le stock (le available_quantity du POST est ignoré).
  const inventoryUpdates: FaireInventoryUpdate[] = variants
    .filter((v) => v.payload.available_quantity > 0)
    .map((v) => ({ sku: v.sku, currentQuantity: v.payload.available_quantity }));
  if (inventoryUpdates.length > 0) {
    const inv = await faireUpdateInventory(inventoryUpdates);
    if (!inv.success) {
      logger.warn("[Faire Publish] PATCH inventory partiel/raté", {
        productId,
        inv,
      });
    }
  }

  try {
    revalidateTag("products", "default");
  } catch {
    // hors contexte Next : ignorer.
  }

  return {
    success: true,
    faireProductId,
    variantMap,
    warnings: validation.warnings,
  };
}
