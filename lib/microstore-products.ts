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
import { assertMicrostorePushAllowed } from "@/lib/microstore-preflight";
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
import { resolveMicrostoreCategoryChoice } from "@/lib/microstore-subcategory";

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
 * Détermine si le produit BJ doit être masqué (`disable=1`) côté vitrine H5
 * Microstore. Règle : OFFLINE ou ARCHIVED côté BJ → masqué. ONLINE ou SYNCING
 * (transitoire) → visible. Le push appelle `/goods/disable` en conséquence
 * après chaque create/update pour maintenir les 2 vitrines cohérentes.
 */
export function shouldDisableOnMicrostore(
  status: ExportProduct["status"],
): boolean {
  return status === "OFFLINE" || status === "ARCHIVED";
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

/**
 * Construit le suffixe "Dimensions : …" ajouté à la fin de la description
 * envoyée à Microstore (`desc`). Même format que PFS/eFashion — cf.
 * `lib/pfs-publish.ts::buildDimensionsSuffix` — pour que les 2 marketplaces
 * affichent les cotes dans le même style. Renvoie "" si le produit n'a
 * aucune dimension.
 */
export function buildMicrostoreDimensionsSuffix(product: {
  dimensionLength: number | null;
  dimensionWidth: number | null;
  dimensionHeight: number | null;
  dimensionDiameter: number | null;
  dimensionCircumference: number | null;
}): string {
  const parts: string[] = [];
  if (product.dimensionLength != null) parts.push(`Longueur : ${product.dimensionLength}mm`);
  if (product.dimensionWidth != null) parts.push(`Largeur : ${product.dimensionWidth}mm`);
  if (product.dimensionHeight != null) parts.push(`Hauteur : ${product.dimensionHeight}mm`);
  if (product.dimensionDiameter != null) parts.push(`Diamètre : ${product.dimensionDiameter}mm`);
  if (product.dimensionCircumference != null)
    parts.push(`Circonférence : ${product.dimensionCircumference}mm`);
  if (parts.length === 0) return "";
  return `\n\nDimensions : ${parts.join(" / ")}`;
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
 * Trouve l'ID d'un attribut Microstore par nom (normalisé). Priorité :
 *   1. `preferredId` fourni (mapping manuel BDD saisi par la cliente) — court-circuite
 *      matching par nom et auto-création. On enrichit quand même le cache pour éviter
 *      un re-fetch dans le batch.
 *   2. Matching par nom normalisé (case-insensitive, sans accents).
 *   3. Auto-création côté Microstore + enrichissement du cache.
 */
async function ensureAttributeId(
  cache: AttrCache,
  type: MicrostoreAttrType,
  name: string,
  preferredId?: number | null,
): Promise<string> {
  const map = pickAttrMap(cache, type);
  const key = normalize(name);
  if (preferredId != null) {
    const id = String(preferredId);
    map.set(key, id);
    return id;
  }
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
  }
}

/**
 * Trouve l'ID d'une couleur Microstore. Même stratégie que `ensureAttributeId` :
 * mapping BDD prioritaire → nom → auto-création.
 */
async function ensureColorId(
  cache: AttrCache,
  name: string,
  preferredId?: number | null,
): Promise<string> {
  const key = normalize(name);
  if (preferredId != null) {
    const id = String(preferredId);
    cache.colorsByName.set(key, id);
    return id;
  }
  const existing = cache.colorsByName.get(key);
  if (existing) return existing;
  const created = await microstoreCreateColor({ name });
  cache.colorsByName.set(key, created.id);
  return created.id;
}

// ─── Mappings manuels BDD (Category/Season/Color → id Microstore) ───────

interface MicrostoreMappings {
  categoryId: number | null;
  seasonId: number | null;
  colorIdByName: Map<string, number>;
}

/**
 * Erreur levée quand un produit BJ n'a pas tous les mappings Microstore
 * requis. Le message liste précisément ce qui manque + où le corriger côté
 * back-office BJ.
 *
 * Reglementaire : aucune tolérance, aucun match par nom, aucune auto-création
 * silencieuse côté Microstore — la cliente veut la certitude que ce qui est
 * poussé correspond exactement à ce qu'elle a choisi.
 */
export class MicrostoreMappingMissingError extends Error {
  public readonly missing: string[];
  constructor(missing: string[]) {
    super(
      `Mapping Microstore incomplet — corrige d'abord :\n  · ${missing.join("\n  · ")}`,
    );
    this.name = "MicrostoreMappingMissingError";
    this.missing = missing;
  }
}

interface ProductMappingSnapshot {
  categoryName: string;
  categoryMicrostoreId: number | null;
  /** Sous-catégorie choisie comme étiquette Microstore, si l'utilisatrice en a
   *  désigné une. `null` = catégorie principale (défaut). Le push utilise cette
   *  sous-catégorie à la place de la catégorie principale, à condition qu'elle
   *  soit elle-même mappée à un ID Microstore. */
  subCategoryName: string | null;
  subCategoryMicrostoreId: number | null;
  seasonName: string | null;
  seasonMicrostoreId: number | null;
  colors: Array<{ name: string; microstoreColorId: number | null }>;
}

/**
 * Charge les mappings BDD Microstore + noms d'entités pour un produit donné.
 * Une seule requête Prisma (attribut par attribut : category, season, colors UNIT).
 */
async function loadProductMappingSnapshot(
  bjProductId: string,
): Promise<ProductMappingSnapshot | null> {
  const p = await prisma.product.findUnique({
    where: { id: bjProductId },
    select: {
      category: { select: { name: true, microstoreCategoryId: true } },
      // Sous-catégorie choisie comme étiquette Microstore (peut être null).
      // On lit son propre microstoreCategoryId : c'est ce qui sera envoyé à
      // Microstore à la place de celui de la catégorie principale.
      microstoreSubCategory: {
        select: { name: true, microstoreCategoryId: true } as never,
      },
      season: { select: { name: true, microstoreSeasonId: true } },
      colors: {
        where: { saleType: "UNIT" },
        select: { color: { select: { name: true, microstoreColorId: true } } },
      },
    },
  });
  if (!p) return null;
  const sub = (p as unknown as {
    microstoreSubCategory: { name: string; microstoreCategoryId: number | null } | null;
  }).microstoreSubCategory;
  return {
    categoryName: p.category?.name ?? "(sans catégorie)",
    categoryMicrostoreId: p.category?.microstoreCategoryId ?? null,
    subCategoryName: sub?.name ?? null,
    subCategoryMicrostoreId: sub?.microstoreCategoryId ?? null,
    seasonName: p.season?.name ?? null,
    seasonMicrostoreId: p.season?.microstoreSeasonId ?? null,
    colors: (p.colors ?? [])
      .filter((c) => c.color)
      .map((c) => ({
        name: c.color!.name,
        microstoreColorId: c.color!.microstoreColorId ?? null,
      })),
  };
}

/**
 * Vérifie que tous les attributs Microstore requis sont mappés en BDD BJ.
 * Refuse le push (throw `MicrostoreMappingMissingError`) si un seul manque.
 *
 * Attributs contrôlés :
 *   - Catégorie (obligatoire) — mais seule la source réellement envoyée est
 *     contrôlée : si la cliente a choisi une sous-catégorie comme étiquette
 *     Microstore, c'est le mapping de la sous-catégorie qui est requis
 *     (l'ID Microstore de la catégorie principale n'est pas envoyé).
 *   - Saison du produit (obligatoire si le produit a une saison rattachée)
 *   - Chaque couleur UNIT du produit (obligatoire pour chaque couleur active)
 *
 * Non contrôlés (auto-création tolérée côté Microstore, car un seul par tenant/
 * année et sans risque de doublon) :
 *   - Marque (= shopName de la boutique)
 *   - Année (= année courante)
 */
async function assertMicrostoreMappings(
  bjProductId: string,
): Promise<ProductMappingSnapshot> {
  const snap = await loadProductMappingSnapshot(bjProductId);
  if (!snap) throw new Error("Produit BJ introuvable pour vérif mapping Microstore.");

  const missing: string[] = [];
  // Décision catégorie principale vs sous-catégorie choisie centralisée dans
  // `resolveMicrostoreCategoryChoice` (helper pur, testé indépendamment).
  const choice = resolveMicrostoreCategoryChoice({
    categoryName: snap.categoryName,
    categoryMicrostoreId: snap.categoryMicrostoreId,
    subCategoryName: snap.subCategoryName,
    subCategoryMicrostoreId: snap.subCategoryMicrostoreId,
  });
  if (!choice.ok) missing.push(choice.missing);
  if (snap.seasonName && snap.seasonMicrostoreId == null) {
    missing.push(
      `Saison « ${snap.seasonName} » → à mapper dans /admin/saisons (carte Microstore)`,
    );
  }
  for (const c of snap.colors) {
    if (c.microstoreColorId == null) {
      missing.push(
        `Couleur « ${c.name} » → à mapper dans /admin/couleurs (carte Microstore)`,
      );
    }
  }
  if (missing.length > 0) throw new MicrostoreMappingMissingError(missing);
  return snap;
}

/**
 * Charge les mappings Microstore d'un produit sous la forme attendue par les
 * helpers `ensureAttributeId` / `ensureColorId` (map colorName normalisé → id).
 * Suppose que `assertMicrostoreMappings` a déjà passé, donc tous les IDs sont
 * non-null.
 */
function toMicrostoreMappings(snap: ProductMappingSnapshot): MicrostoreMappings {
  const colorIdByName = new Map<string, number>();
  for (const c of snap.colors) {
    if (c.microstoreColorId != null) colorIdByName.set(normalize(c.name), c.microstoreColorId);
  }
  // Étiquette Microstore : sous-catégorie si l'utilisatrice en a choisi une,
  // sinon catégorie principale. `assertMicrostoreMappings` a déjà validé que
  // la source retenue est mappée — ici on se contente de la relire.
  const choice = resolveMicrostoreCategoryChoice({
    categoryName: snap.categoryName,
    categoryMicrostoreId: snap.categoryMicrostoreId,
    subCategoryName: snap.subCategoryName,
    subCategoryMicrostoreId: snap.subCategoryMicrostoreId,
  });
  return {
    categoryId: choice.ok ? choice.categoryId : null,
    seasonId: snap.seasonMicrostoreId,
    colorIdByName,
  };
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

  // Pré-check strict : refuse le push si un mapping requis manque (catégorie,
  // saison, ou une couleur). Aucune tolérance : la cliente veut la garantie
  // que ce qui est poussé correspond exactement à ses correspondances BDD,
  // aucun match par nom, aucune création silencieuse côté Microstore.
  const snapshot = await assertMicrostoreMappings(product.id);
  const mappings = toMicrostoreMappings(snapshot);

  // Résout les IDs des attributs Microstore.
  //   - Category / Season : mapping BDD strict, garanti par assertMicrostoreMappings.
  //   - Brand / Year : dérivés (shopName + année courante), auto-création tolérée
  //     car un seul par tenant/année, aucun risque de doublon.
  //   - Color : mapping BDD strict, garanti par assertMicrostoreMappings.
  const categoryName = product.microstoreCategoryOverride || product.categoryName;
  const [catId, brandId, yearId, seasonId] = await Promise.all([
    ensureAttributeId(cache, "category", categoryName, mappings.categoryId),
    ensureAttributeId(cache, "brand", ctx.shopName),
    ensureAttributeId(cache, "year", String(year)),
    mappings.seasonId != null
      ? ensureAttributeId(cache, "season", product.seasonName || "", mappings.seasonId)
      : ensureAttributeId(cache, "season", product.seasonName || "Toutes saisons"),
  ]);

  // Microstore refuse les prix différents entre variantes d'un même produit
  // (`err=9999 debug_msg="price_1 diff"` sur /goods/add). Règle métier BJ :
  // on prend le prix de la PREMIÈRE variante UNIT (les PACK sont déjà exclus
  // par bucketProductByColor). Simple et prévisible pour la cliente.
  const unifiedPrice = variantUnitPriceWithMarkup(buckets[0].variant, markup);

  // Remise BJ (Product.discountPercent, 0..100) → facteur Microstore (0..1).
  // Microstore laisse `price` inchangé (prix barré affiché plein tarif) et
  // applique `sale_1..sale_4` pour calculer le prix soldé côté vitrine H5.
  // Comportement identique à celui de MC Gérant quand la cliente y saisit une
  // remise manuellement.
  const saleFactor =
    product.discountPercent != null
      ? Math.max(0, 1 - product.discountPercent / 100)
      : 1;

  // Build SKU inputs (BJ side) — la couleur DOIT être mappée en BDD.
  const bjSkus: MicrostoreSkuInput[] = [];
  for (let i = 0; i < buckets.length; i++) {
    const b = buckets[i];
    const preferredColorId = mappings.colorIdByName.get(normalize(b.colorName));
    if (preferredColorId == null) {
      // Sécurité : assertMicrostoreMappings a déjà couvert ce cas mais garde
      // ce garde-fou au cas où le snapshot et les buckets divergent.
      throw new MicrostoreMappingMissingError([
        `Couleur « ${b.colorName} » → à mapper dans /admin/couleurs (carte Microstore)`,
      ]);
    }
    const colorId = await ensureColorId(cache, b.colorName, preferredColorId);
    bjSkus.push({
      color_id: colorId,
      color_name: b.colorName,
      color_alias: "",
      stock: b.variant.stock,
      price: unifiedPrice,
      orderBy: i + 1,
      saleFactor,
    });
  }

  const remarkMaterial = formatCompositionMicrostore(product);
  const weightGrams = Math.round(Number(buckets[0].variant.weight) * 1000);
  const defaultPrice = unifiedPrice;

  const basePayload: MicrostoreGoodsPayload = {
    itemRef: product.reference,
    name: pickTranslation(product, "fr", "name"),
    desc: pickTranslation(product, "fr", "description") + buildMicrostoreDimensionsSuffix(product),
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
    saleFactor,
    // Visibilité vitrine H5 : OFFLINE/ARCHIVED → masqué. Le flag est passé
    // directement dans /goods/add et /goods/update pour éviter /goods/disable
    // (endpoint séparé qui rejette "Service App error" sur certains tokens).
    disabled: shouldDisableOnMicrostore(product.status),
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

  // Pré-check strict : refuse tant que Gestion Produits + token QR + Station de
  // transfert ne sont pas tous les 3 valides. Centralisé pour couvrir push
  // fiche + bulk + queue worker + stock silencieux d'un seul appel.
  const preflight = await assertMicrostorePushAllowed();
  if (!preflight.ok) {
    return {
      success: false,
      productsSent: 0,
      rowsSent: 0,
      error: preflight.error,
    };
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
  const remarque = pickTranslation(p, "fr", "description") + buildMicrostoreDimensionsSuffix(p);
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
