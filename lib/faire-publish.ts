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
import { resolveFaireCountry } from "@/lib/faire-country";
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
  hsCode: { code: string; faireFormat: string | null } | null;
  category: {
    id: string;
    faireTaxonomyId: string | null;
    faireHsCode: string | null;
  } | null;
  colors: FullVariant[];
  colorImages: { path: string; order: number; colorId: string }[];
  compositions: {
    percentage: Prisma.Decimal | number;
    composition: { name: string; faireMaterialLabel: string | null };
  }[];
  manufacturingCountry: { isoCode: string | null; faireCountryCode: string | null } | null;
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
      hsCode: { select: { code: true, faireFormat: true } },
      category: {
        select: {
          id: true,
          faireTaxonomyId: true,
          faireHsCode: true,
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
          composition: { select: { name: true, faireMaterialLabel: true } },
        },
      },
      manufacturingCountry: { select: { isoCode: true, faireCountryCode: true } },
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
  hsCode: string | null;
  countryAlpha3: string;
  materials: string[];
  countryUsedFallback: boolean;
}

interface FaireVariantPayload {
  bjVariantId: string;
  sku: string;
  payload: {
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
        sku,
        name: variantName,
        wholesale_price_cents: prices.wholesaleCents,
        retail_price_cents: prices.retailCents,
        available_quantity: stock,
        active: stock > 0 || product.status !== "ARCHIVED",
        options: [{ name: "Color", value: colorLabel }],
        ...(images ? { images } : {}),
        ...(measurements ? { measurements } : {}),
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

  const body: Record<string, unknown> = {
    name: product.name,
    description: product.description || "",
    short_description: product.description?.slice(0, 200) || "",
    lifecycle_state: lifecycleState,
    sale_state: product.status === "ONLINE" ? "FOR_SALE" : "NOT_FOR_SALE",
    taxonomy_type: { id: ctx.taxonomyTypeId },
    country_of_manufacture: ctx.countryAlpha3,
    materials: ctx.materials,
    minimum_order_quantity: 1,
    per_style_minimum_order_quantity: 1,
    variant_option_sets: [
      { name: "Color", values: Array.from(optionValuesSet) },
    ],
    variants: variants.map((v) => v.payload),
    ...rootPrices,
    ...(ctx.hsCode ? { hs_code: ctx.hsCode } : {}),
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
  lifecycleState: "DRAFT" | "PUBLISHED" | "RETIRED",
  saleState: "FOR_SALE" | "NOT_FOR_SALE",
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
    };
  }
  return {
    schemaVersion: FAIRE_SNAPSHOT_VERSION,
    product: {
      name: product.name,
      shortDescription: product.description?.slice(0, 200) || "",
      description: product.description || "",
      taxonomyTypeId: ctx.taxonomyTypeId,
      countryAlpha3: ctx.countryAlpha3,
      materials: ctx.materials,
      hsCode: ctx.hsCode ?? "",
      minimumOrderQuantity: 1,
      perStyleMinimumOrderQuantity: 1,
    },
    variants: variantSnapshot,
    lifecycleState,
    saleState,
  };
}

// ─────────────────────────────────────────────
// Validation prep — résout taxonomyId / hsCode / country / materials
// ─────────────────────────────────────────────

export function buildPublishContext(product: Pick<FullProduct, "category" | "hsCode" | "manufacturingCountry" | "compositions">): {
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

  // Priorité : HsCode.faireFormat (pointé) > HsCode.code (chiffres bruts) > Category.faireHsCode (legacy).
  const hsCode =
    product.hsCode?.faireFormat ||
    product.hsCode?.code ||
    product.category?.faireHsCode ||
    null;
  const alpha2 = product.manufacturingCountry?.isoCode ?? null;
  // Priorité 1 : override manuel saisi dans la modale pays (faireCountryCode)
  // Priorité 2 : table embarquée alpha-2 → alpha-3 (lib/faire-country.ts)
  // Priorité 3 : fallback "CHN" (catalogue BJ majoritairement made-in-China)
  const overrideAlpha3 = product.manufacturingCountry?.faireCountryCode?.trim().toUpperCase() || null;
  const countryAlpha3 = overrideAlpha3 ?? resolveFaireCountry(alpha2);
  const countryUsedFallback = alpha2 == null || countryAlpha3 === "CHN" && alpha2?.toUpperCase() !== "CN";

  const materials = product.compositions
    .map((c) => c.composition.faireMaterialLabel?.trim())
    .filter((s): s is string => !!s);

  return {
    ok: true,
    ctx: {
      taxonomyTypeId,
      hsCode,
      countryAlpha3,
      materials,
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
    countryAlpha3: ctx.countryAlpha3,
    materials: ctx.materials,
    hsCode: ctx.hsCode,
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
    product.status === "ONLINE" ? "FOR_SALE" : "NOT_FOR_SALE",
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
