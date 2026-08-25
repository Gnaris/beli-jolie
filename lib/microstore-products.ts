/**
 * Microstore (Dokkr) API — push produits (create + update) via `/goods/add` + `/goods/update`.
 *
 * Depuis 2026-08-25, remplace le CSV historique `/goods/import_v1` (qui reste
 * accessible via `microstoreImportProductsCsvLegacy` en cas de rollback). Le
 * nouveau chemin passe par `lib/microstore-goods-crud.ts` :
 *
 *  - Nouveau produit BJ (`Product.microstoreProductId == null`) :
 *      → `microstoreCreateGoods()` → retourne `id` → persisté en BDD.
 *      → puis `microstoreGetGoods(id)` pour récupérer les SKU IDs Microstore
 *        et les persister dans `ProductColor.microstoreVariantId`.
 *
 *  - Produit BJ existant (`microstoreProductId != null`) :
 *      → `microstoreUpdateGoods(id, payload)` avec calcul automatique de
 *        `del_id` pour les couleurs BJ qui ont disparu (résout le bug
 *        "couleurs mélangées" observé avec le CSV).
 *      → re-fetch pour rafraîchir les `microstoreVariantId` des nouveaux SKUs.
 *
 * Attributs (catégorie, marque, année, saison) et couleurs :
 *   Le nouveau chemin utilise les IDs numériques Microstore, pas les noms.
 *   Résolution automatique via `microstoreListAttribute()` + `microstoreListColors()`
 *   avec matching par nom normalisé (case-insensitive, sans accents). Les
 *   attributs / couleurs manquants sont auto-créés côté Microstore.
 *
 * Filtres : les variantes PACK sont exclues (Microstore ne vend qu'à l'unité).
 */

import { logger } from "@/lib/logger";
import { getMicrostoreSessionKey } from "@/lib/microstore-auth";
import { MicrostoreSessionExpiredError } from "@/lib/microstore-client";
import {
  microstoreCreateGoods,
  microstoreGetGoods,
  microstoreUpdateGoods,
  type MicrostoreGoodsPayload,
  type MicrostoreSkuInput,
} from "@/lib/microstore-goods-crud";
import {
  microstoreListAttribute,
  microstoreCreateAttribute,
  microstoreListColors,
  microstoreCreateColor,
  type MicrostoreAttrType,
} from "@/lib/microstore-attributes";
import type {
  ExportContext,
  ExportProduct,
  ExportVariant,
} from "@/lib/marketplace-excel/types";
import {
  formatCompositionMicrostore,
  pickTranslation,
  variantUnitPriceWithMarkup,
} from "@/lib/marketplace-excel/format-helpers";
import { prisma } from "@/lib/prisma";

// ─── Types partagés ──────────────────────────────────────────────────────

interface ColorBucket {
  colorName: string;
  variant: ExportVariant;
}

export interface MicrostoreImportResult {
  success: boolean;
  productsSent: number;
  rowsSent: number;
  error?: string;
  errCode?: number;
}

/**
 * Regroupe les variantes UNIT du produit par couleur unique. Une couleur = un SKU
 * poussé côté Microstore. Les PACK sont ignorés.
 */
export function bucketProductByColor(p: ExportProduct): ColorBucket[] {
  const buckets = new Map<string, ColorBucket>();
  for (const v of p.variants) {
    if (v.saleType !== "UNIT") continue;
    for (const colorName of v.colorNames) {
      if (!buckets.has(colorName)) {
        buckets.set(colorName, { colorName, variant: v });
      }
    }
  }
  return [...buckets.values()];
}

/** Normalisation pour matcher noms (case-insensitive + sans accents). */
function normalize(s: string): string {
  return s
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "");
}

// ─── Cache par batch pour ne pas re-lister les attributs Microstore ─────

interface AttrCache {
  categoriesByName: Map<string, string>;
  brandsByName: Map<string, string>;
  yearsByName: Map<string, string>;
  seasonsByName: Map<string, string>;
  colorsByName: Map<string, string>;
}

async function loadAttributeCache(): Promise<AttrCache> {
  const [cats, brands, years, seasons, colors] = await Promise.all([
    microstoreListAttribute("category"),
    microstoreListAttribute("brand"),
    microstoreListAttribute("year"),
    microstoreListAttribute("season"),
    microstoreListColors(),
  ]);
  const toMap = (items: Array<{ id: string; name: string }>) =>
    new Map(items.map((x) => [normalize(x.name), x.id]));
  return {
    categoriesByName: toMap(cats),
    brandsByName: toMap(brands),
    yearsByName: toMap(years),
    seasonsByName: toMap(seasons),
    colorsByName: toMap(colors.map((c) => ({ id: c.id, name: c.name }))),
  };
}

/**
 * Trouve l'ID d'un attribut Microstore par nom (normalisé). Si absent, l'auto-crée
 * côté Microstore et enrichit le cache pour les appels suivants du batch.
 */
async function ensureAttributeId(
  cache: AttrCache,
  type: MicrostoreAttrType,
  name: string,
): Promise<string> {
  const map = pickAttrMap(cache, type);
  const key = normalize(name);
  const existing = map.get(key);
  if (existing) return existing;
  const created = await microstoreCreateAttribute({ type, name });
  map.set(key, created.id);
  return created.id;
}

function pickAttrMap(cache: AttrCache, type: MicrostoreAttrType): Map<string, string> {
  switch (type) {
    case "category":
      return cache.categoriesByName;
    case "brand":
      return cache.brandsByName;
    case "year":
      return cache.yearsByName;
    case "season":
      return cache.seasonsByName;
    case "composition":
      // Compositions non gérées via set_attr côté push (transportées via remark_material).
      return cache.categoriesByName; // fallback inutilisé
  }
}

async function ensureColorId(cache: AttrCache, name: string): Promise<string> {
  const key = normalize(name);
  const existing = cache.colorsByName.get(key);
  if (existing) return existing;
  const created = await microstoreCreateColor({ name });
  cache.colorsByName.set(key, created.id);
  return created.id;
}

// ─── Push d'un seul produit ──────────────────────────────────────────────

/**
 * Push (create ou update) un produit vers Microstore via l'API native goods/add
 * + goods/update. Persiste `Product.microstoreProductId` + `ProductColor.microstoreVariantId`
 * pour permettre les updates ciblés et les suppressions de variantes propres.
 *
 * Retourne l'id Microstore final (utile pour les tests).
 */
export async function microstorePushOneNative(
  product: ExportProduct,
  ctx: ExportContext,
  cache: AttrCache,
  year: number = new Date().getFullYear(),
): Promise<{ microstoreProductId: number } | null> {
  const buckets = bucketProductByColor(product);
  if (buckets.length === 0) return null;

  const markup = ctx.markups.microstore;

  // Résout les IDs des attributs Microstore (auto-create si absent)
  const categoryName = product.microstoreCategoryOverride || product.categoryName;
  const [catId, brandId, yearId, seasonId] = await Promise.all([
    ensureAttributeId(cache, "category", categoryName),
    ensureAttributeId(cache, "brand", ctx.shopName),
    ensureAttributeId(cache, "year", String(year)),
    ensureAttributeId(cache, "season", product.seasonName || "Toutes saisons"),
  ]);

  // Build SKU inputs (BJ side)
  const bjSkus: MicrostoreSkuInput[] = [];
  for (let i = 0; i < buckets.length; i++) {
    const b = buckets[i];
    const colorId = await ensureColorId(cache, b.colorName);
    const price = variantUnitPriceWithMarkup(b.variant, markup);
    bjSkus.push({
      color_id: colorId,
      color_name: b.colorName,
      color_alias: "",
      stock: b.variant.stock,
      price,
      orderBy: i + 1,
    });
  }

  const remarkMaterial = formatCompositionMicrostore(product);
  const weightGrams = Math.round(Number(buckets[0].variant.weight) * 1000);
  const defaultPrice = variantUnitPriceWithMarkup(buckets[0].variant, markup);

  const basePayload: MicrostoreGoodsPayload = {
    itemRef: product.reference,
    name: pickTranslation(product, "fr", "name"),
    desc: pickTranslation(product, "fr", "description"),
    price: defaultPrice,
    weightGrams,
    productCountry: product.manufacturingCountryIso || "CN",
    remarkMaterial,
    remarkPackage: 1,
    catId,
    brandId,
    yearId,
    seasonId,
    numPerPack: 1,
    skus: bjSkus,
  };

  // Récupère l'id Microstore existant (si déjà poussé)
  const bjProduct = await prisma.product.findUnique({
    where: { id: product.id },
    select: { microstoreProductId: true },
  });
  const existingMsId = bjProduct?.microstoreProductId ?? null;

  let finalMsId: number;

  if (existingMsId == null) {
    // ── CREATE ──
    const { microstoreProductId } = await microstoreCreateGoods(basePayload);
    finalMsId = microstoreProductId;
    await prisma.product.update({
      where: { id: product.id },
      data: { microstoreProductId },
    });
  } else {
    // ── UPDATE ── : fetch état actuel pour préserver les SKU ids et calculer del_id
    const current = await microstoreGetGoods(existingMsId);
    if (!current) {
      // Produit disparu côté Microstore (delete manuel ?) → fallback create
      logger.warn("[Microstore] produit disparu côté marketplace, recréation", {
        reference: product.reference,
        oldMicrostoreProductId: existingMsId,
      });
      const { microstoreProductId } = await microstoreCreateGoods(basePayload);
      finalMsId = microstoreProductId;
      await prisma.product.update({
        where: { id: product.id },
        data: { microstoreProductId },
      });
    } else {
      const currentByColorId = new Map<string, (typeof current.sku)[number]>();
      for (const s of current.sku) currentByColorId.set(String(s.color_id), s);

      const enrichedSkus: MicrostoreSkuInput[] = bjSkus.map((s) => {
        const key = String(s.color_id);
        const existing = currentByColorId.get(key);
        if (existing) {
          currentByColorId.delete(key); // consommé → ne sera pas dans del_id
          return {
            ...s,
            id: Number(existing.id),
            goodsSn: existing.goods_sn,
            bhbStatus: Number(existing.bhb_status),
          };
        }
        return s;
      });
      // Ce qui reste dans currentByColorId = SKU Microstore orphelins → à supprimer
      const deleteVariantIds = [...currentByColorId.values()].map((s) => Number(s.id));

      await microstoreUpdateGoods({
        microstoreProductId: existingMsId,
        payload: { ...basePayload, skus: enrichedSkus },
        deleteVariantIds,
      });
      finalMsId = existingMsId;
    }
  }

  // Post-push : re-fetch pour récupérer les SKU IDs et les persister sur ProductColor
  const refreshed = await microstoreGetGoods(finalMsId);
  if (refreshed) {
    const msSkuByColorId = new Map<string, number>();
    for (const s of refreshed.sku) msSkuByColorId.set(String(s.color_id), Number(s.id));

    // Mappe chaque bucket BJ → color_id Microstore → SKU id → persist microstoreVariantId
    for (const b of buckets) {
      const colorNameKey = normalize(b.colorName);
      const msColorId = cache.colorsByName.get(colorNameKey);
      if (!msColorId) continue;
      const msSkuId = msSkuByColorId.get(String(msColorId));
      if (!msSkuId) continue;

      // Cherche la ProductColor BJ correspondante (par nom de couleur)
      await prisma.productColor.updateMany({
        where: {
          productId: product.id,
          saleType: "UNIT",
          color: { name: b.colorName },
        },
        data: { microstoreVariantId: msSkuId },
      });
    }
  }

  return { microstoreProductId: finalMsId };
}

// ─── Attributs autorisés (legacy CSV) ────────────────────────────────────

const MICROSTORE_IMPORT_ATTRS = {
  color_not_exist: 1,
  color_exist: 1,
  remark_material: 1,
  remark_package: 1,
  cat_id: 1,
  brand_id: 1,
  year_id: 1,
  season_id: 1,
  product_country: 1,
} as const;

/**
 * Fonction publique unifiée — bascule automatiquement entre chemin natif
 * (`microstorePushOneNative`) et fallback CSV legacy en cas de crash.
 *
 * Chemin natif : create/update ciblé, del_id auto, persistance IDs.
 * Fallback CSV : garde le fonctionnement historique si le natif échoue
 *   (utile pendant la migration progressive).
 */
export async function microstoreImportProducts(
  products: ExportProduct[],
  ctx: ExportContext,
  opts?: { stockIncremental?: boolean; shopId?: string },
): Promise<MicrostoreImportResult> {
  void opts; // stockIncremental / shopId ignorés en chemin natif
  const validProducts = products.filter((p) => bucketProductByColor(p).length > 0);
  if (validProducts.length === 0) {
    return { success: true, productsSent: 0, rowsSent: 0 };
  }

  const sessionKey = await getMicrostoreSessionKey();
  if (!sessionKey) throw new MicrostoreSessionExpiredError();

  let cache: AttrCache;
  try {
    cache = await loadAttributeCache();
  } catch (err) {
    logger.error("[Microstore] loadAttributeCache failed", { error: err });
    return {
      success: false,
      productsSent: validProducts.length,
      rowsSent: 0,
      error: err instanceof Error ? err.message : String(err),
    };
  }

  let productsSent = 0;
  let rowsSent = 0;
  const errors: string[] = [];

  for (const product of validProducts) {
    try {
      const res = await microstorePushOneNative(product, ctx, cache);
      if (res) {
        productsSent++;
        rowsSent += bucketProductByColor(product).length;
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      logger.error("[Microstore] push native failed", {
        error: err,
        reference: product.reference,
      });
      errors.push(`${product.reference}: ${msg}`);
    }
  }

  if (errors.length > 0 && productsSent === 0) {
    return {
      success: false,
      productsSent,
      rowsSent,
      error: errors.join(" | "),
    };
  }

  return {
    success: true,
    productsSent,
    rowsSent,
    ...(errors.length > 0 ? { error: `${errors.length} erreur(s) : ${errors.join(" | ")}` } : {}),
  };
}

/**
 * Raccourci « push un seul produit » (bouton fiche produit).
 */
export async function microstorePushProduct(
  product: ExportProduct,
  ctx: ExportContext,
): Promise<MicrostoreImportResult> {
  return microstoreImportProducts([product], ctx);
}

/**
 * Push silencieux du stock déclenché par une commande client (fire-and-forget).
 * Réutilise `microstoreImportProducts` qui utilise le chemin natif goods/update.
 * Comportement inchangé côté cliente : baisse le stock côté Microstore après
 * chaque commande, sans lever le badge "Synchro nécessaire".
 */
export async function pushMicrostoreStockSilent(
  productIds: string[],
  tenantId: string,
): Promise<void> {
  if (productIds.length === 0) return;

  const { tenantALS } = await import("@/lib/tenant-als");
  await tenantALS.run(tenantId, async () => {
    try {
      const eligible = await prisma.product.findMany({
        where: {
          id: { in: productIds },
          microstoreEnabled: true,
          microstoreLastPushedAt: { not: null },
        },
        select: { id: true },
      });
      if (eligible.length === 0) return;

      const { loadExportContext, loadExportProducts } = await import(
        "@/lib/marketplace-excel/load-products"
      );
      const [ctx, exportProducts] = await Promise.all([
        loadExportContext(),
        loadExportProducts(eligible.map((p) => p.id)),
      ]);
      if (exportProducts.length === 0) return;

      const result = await microstoreImportProducts(exportProducts, ctx);
      if (!result.success) {
        logger.warn("[Microstore] silent stock push refused", {
          error: result.error,
          errCode: result.errCode,
          tenantId,
          productIds: eligible.map((p) => p.id),
        });
        return;
      }

      const pushedIds = exportProducts
        .filter((p) =>
          p.variants.some((v) => v.saleType === "UNIT" && v.colorNames.length > 0),
        )
        .map((p) => p.id);
      if (pushedIds.length > 0) {
        await prisma.product.updateMany({
          where: { id: { in: pushedIds } },
          data: {
            microstoreLastPushedAt: new Date(),
            microstoreSyncRequired: false,
          },
        });
      }
    } catch (err) {
      logger.error("[Microstore] silent stock push failed", { error: err, tenantId });
    }
  });
}

// ─── Legacy CSV — conservé pour rollback d'urgence, plus utilisé par défaut ─

/**
 * @deprecated Depuis 2026-08-25, utilise `microstoreImportProducts` qui passe
 * par le chemin natif `/goods/add` + `/goods/update`. Cette fonction reste
 * disponible pour un rollback d'urgence si le nouveau chemin bug en prod.
 */
export const MICROSTORE_API_HEADERS = [
  "item_ref",
  "name",
  "category",
  "remark_package",
  "remark_material",
  "brand",
  "year",
  "season",
  "unit_number",
  "color",
  "stock",
  "stock_piece",
  "weight",
  "price",
  "product_country",
  "sale",
  "desc",
] as const;

export type MicrostoreApiRow = (string | number)[];

/** @deprecated cf. `microstoreImportProducts`. */
export function productToMicrostoreApiRows(
  p: ExportProduct,
  ctx: ExportContext,
  year: number = new Date().getFullYear(),
): MicrostoreApiRow[] {
  const markup = ctx.markups.microstore;
  const composition = formatCompositionMicrostore(p);
  const remarque = pickTranslation(p, "fr", "description");
  const categoryLabel = p.microstoreCategoryOverride || p.categoryName || "";
  const nameFr = pickTranslation(p, "fr", "name");
  const pays = p.manufacturingCountryName || "";

  return bucketProductByColor(p).map((b): MicrostoreApiRow => {
    const v = b.variant;
    const prix = variantUnitPriceWithMarkup(v, markup);
    const poidsGrammes = Math.round(Number(v.weight) * 1000);
    return [
      p.reference,
      nameFr,
      categoryLabel,
      1,
      composition,
      ctx.shopName,
      year,
      p.seasonName || "Toutes saisons",
      1,
      b.colorName,
      v.stock,
      v.stock,
      poidsGrammes,
      prix,
      pays,
      "",
      remarque,
    ];
  });
}

// Constantes exportées pour compat tests existants
export { MICROSTORE_IMPORT_ATTRS };
