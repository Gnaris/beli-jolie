/**
 * Microstore (Dokkr) — CRUD produit via `/goods/add` + `/goods/update` + `/goods/get`.
 *
 * Remplace progressivement le CSV `/goods/import_v1` de `lib/microstore-products.ts` :
 *  - `microstoreCreateGoods()`  → POST /goods/add    → retourne `id` numérique
 *  - `microstoreGetGoods()`     → POST /goods/get    → lit fiche complète + SKUs
 *  - `microstoreUpdateGoods()`  → POST /goods/update → update ciblé + del_id auto
 *  - `microstoreDeleteVariants()` → wrapper /goods/update avec del_id uniquement
 *
 * Auth : réutilise le token QR compagnon stocké dans `SiteConfig.microstore_session_key`
 * (préfixe `5_XXX`). Validé le 2026-08-25 sur produit test A2630 : ce token autorise
 * les writes /goods/update en parallèle de la session mobile MC Gérant.
 *
 * Format wire : `application/x-www-form-urlencoded`. Les tableaux (sku, del_id) sont
 * sérialisés en JSON string dans le body. C'est le format observé dans les HAR de
 * l'appli mobile Dart/Flutter — reproduit à l'identique pour éviter les 9999
 * "same sku but no id" ou "Wrong signature" côté serveur Microstore.
 *
 * ⚠ Piège documenté 2026-08-25 : passer un SKU existant SANS son champ `id` déclenche
 * `err=9999 debug=same sku but no id`. Toujours inclure `id` sur les SKUs à préserver.
 */

import {
  getMicrostoreSessionKey,
  isMicrostoreSessionExpiredError,
} from "@/lib/microstore-auth";
import { MicrostoreSessionExpiredError } from "@/lib/microstore-client";
import { logger } from "@/lib/logger";

const MC_API_BASE = "https://api2.dokkr.net/index.php";

// ─── Types API Microstore ────────────────────────────────────────────────

/**
 * Description d'une variante SKU côté Microstore. `id` est présent uniquement
 * pour les SKU existants qu'on veut préserver/modifier — pour un SKU nouveau,
 * on l'omet et Microstore l'assigne côté serveur.
 */
export interface MicrostoreSkuInput {
  /** SKU id Microstore (obligatoire pour préserver un SKU existant). */
  id?: number;
  /** ID couleur Microstore (bibliothèque /user/get_color). */
  color_id: string | number;
  /** Nom couleur (informationnel, l'ID prime pour le matching). */
  color_name: string;
  /** Alias optionnel (rarement utilisé, laisser vide par défaut). */
  color_alias?: string;
  /** Stock disponible dans le warehouse principal (warehouse_id=1). */
  stock: number;
  /** Prix unitaire HT — même valeur pour toutes les grilles tarifaires (1..8). */
  price: number;
  /** Ordre d'affichage (1-indexé). */
  orderBy: number;
  /** SKU technique existant à ré-utiliser (obligatoire si on préserve un SKU). */
  goodsSn?: string;
  /** État BHB (bhb_status) — 0 par défaut, 1 = actif pour vitrine H5. */
  bhbStatus?: number;
}

/**
 * Payload commun à /goods/add et /goods/update.
 */
export interface MicrostoreGoodsPayload {
  /** Référence unique côté BJ (= Product.reference). */
  itemRef: string;
  /** Nom du produit. */
  name: string;
  /** Description longue. */
  desc: string;
  /** Prix unitaire par défaut (utilisé si un SKU ne définit pas son propre prix). */
  price: number;
  /** Poids en grammes (pas kg — l'API Microstore attend des grammes). */
  weightGrams: number;
  /** Pays de fabrication ISO alpha-2 (ex "FR", "CN"). */
  productCountry: string;
  /** Composition matière au format libre ("50% Laiton - 50% Acier inoxydable"). */
  remarkMaterial: string;
  /** Contenu colis — nombre de pièces par unité vendue (typiquement 1). */
  remarkPackage: number;
  /** ID catégorie Microstore (bibliothèque /goods/get_category). */
  catId: string | number;
  /** ID marque (typiquement `Beli & Jolie`). */
  brandId: string | number;
  /** ID année. */
  yearId: string | number;
  /** ID saison. */
  seasonId: string | number;
  /** Nombre de pièces par paquet (colisage) — typiquement 1 pour vente à l'unité. */
  numPerPack?: number;
  /** SKUs (1 par couleur). */
  skus: MicrostoreSkuInput[];
}

/** Structure retournée par `/goods/get` (champs pertinents pour un round-trip). */
export interface MicrostoreGoodsInfo {
  id: string;
  item_ref: string;
  name: string;
  desc?: string;
  price: string;
  num_per_pack: string;
  product_country?: string;
  weight?: string;
  remark_material?: string;
  remark_package?: string;
  cat_id: string;
  brand_id?: string;
  year_id?: string;
  season_id?: string;
  box1?: string;
  box2?: string;
  box3?: string;
  size_ratio_switch?: string;
  disable?: string;
  bhb_updown?: string;
  sku: Array<{
    id: string;
    color_id: string;
    color_name: string;
    color_alias?: string;
    goods_sn: string;
    bhb_status: number | string;
    num_1: string;
    price: string;
    price_1: string;
    order_by?: string | number;
  }>;
}

interface McErrorPayload {
  err?: number;
  msg?: string;
  debug_msg?: string;
}

// ─── HTTP low-level ──────────────────────────────────────────────────────

async function callMicrostorePost<T>(
  path: string,
  body: URLSearchParams,
): Promise<T & McErrorPayload> {
  let res: Response;
  try {
    res = await fetch(`${MC_API_BASE}${path}`, {
      method: "POST",
      headers: {
        "content-type": "application/x-www-form-urlencoded",
        "app-pid": "91",
        "app-version": "2.76.21",
        "api-version": "1.0",
        lang: "en",
        "user-agent": "Dart/3.11 (dart:io)",
      },
      body: body.toString(),
      cache: "no-store",
    });
  } catch (err) {
    logger.error("[Microstore CRUD] network error", { error: err, path });
    throw new Error("Impossible de contacter Microstore.");
  }
  if (!res.ok) {
    throw new Error(`Microstore a répondu HTTP ${res.status} sur ${path}.`);
  }
  const data = (await res.json().catch(() => null)) as
    | (T & McErrorPayload)
    | null;
  if (!data) throw new Error("Réponse Microstore invalide.");
  if (isMicrostoreSessionExpiredError(data.err)) {
    throw new MicrostoreSessionExpiredError();
  }
  return data;
}

// ─── Sérialisation du payload ────────────────────────────────────────────

/**
 * Sérialise un `MicrostoreSkuInput` au format JSON attendu par /goods/update.
 * Sortie identique aux HAR mobile (Dart/Flutter) : `stock_1` + `num_1` égaux,
 * 4 grilles tarifaires + 4 `sale_N=1`. Le champ `id` n'est ajouté que s'il est
 * défini (sinon Microstore crée un nouveau SKU).
 */
export function serializeSkuForApi(sku: MicrostoreSkuInput): Record<string, unknown> {
  const stockStr = String(sku.stock);
  const priceStr = sku.price.toFixed(2);
  const base: Record<string, unknown> = {
    color_id: String(sku.color_id),
    color_name: sku.color_name,
    color_alias: sku.color_alias || "",
    pic_url: null,
    imgs: sku.id ? [""] : [],
    goods_sn: sku.goodsSn ?? "",
    bhb_status: sku.bhbStatus ?? (sku.id ? 0 : 1),
    stock_1: stockStr,
    num_1: stockStr,
    order_by: sku.orderBy,
    price: priceStr,
    price_1: priceStr,
    sale_1: 1,
    sale_2: 1,
    sale_3: 1,
    sale_4: 1,
  };
  if (typeof sku.id === "number") base.id = sku.id;
  return base;
}

/**
 * Construit un `URLSearchParams` prêt pour /goods/add ou /goods/update.
 * `productId` = null pour create, id numérique pour update.
 * `deleteVariantIds` = liste des SKU id Microstore à supprimer (del_id JSON).
 */
export function buildGoodsFormBody(opts: {
  sessionKey: string;
  productId: number | null;
  payload: MicrostoreGoodsPayload;
  deleteVariantIds?: number[];
}): URLSearchParams {
  const { sessionKey, productId, payload, deleteVariantIds } = opts;
  const p = new URLSearchParams();
  p.set("key", sessionKey);
  if (productId != null) p.set("id", String(productId));
  p.set("item_ref", payload.itemRef);
  p.set("name", payload.name);
  p.set("desc", payload.desc);
  p.set("price", payload.price.toFixed(2));
  p.set("sale_1", "1");
  p.set("sale_2", "1");
  p.set("sale_3", "1");
  p.set("sale_4", "1");
  p.set("num_per_pack", String(payload.numPerPack ?? 1));
  p.set("product_country", payload.productCountry || "CN");
  p.set("weight", String(payload.weightGrams));
  p.set("remark_material", payload.remarkMaterial);
  p.set("remark_package", String(payload.remarkPackage ?? 1));
  p.set("cat_id", String(payload.catId));
  p.set("brand_id", String(payload.brandId));
  p.set("year_id", String(payload.yearId));
  p.set("season_id", String(payload.seasonId));
  p.set("box1", "0");
  p.set("box2", "0");
  p.set("box3", "0");
  p.set("extension_2", "");
  p.set("del_id", JSON.stringify((deleteVariantIds ?? []).map(String)));
  p.set("size_list", "[]");
  p.set("size_ratio_switch", "0");
  p.set("new_order", "1");
  p.set("sku", JSON.stringify(payload.skus.map(serializeSkuForApi)));
  p.set("app_version", "2.76.21");
  p.set("app_pid", "91");
  p.set("api_version", "1.0");
  p.set("lang", "en");
  return p;
}

// ─── Fonctions publiques ─────────────────────────────────────────────────

/**
 * Crée un produit côté Microstore. Retourne l'`id` numérique attribué par
 * Microstore, à persister dans `Product.microstoreProductId`.
 */
export async function microstoreCreateGoods(
  payload: MicrostoreGoodsPayload,
): Promise<{ microstoreProductId: number }> {
  const key = await getMicrostoreSessionKey();
  if (!key) throw new MicrostoreSessionExpiredError();

  const body = buildGoodsFormBody({ sessionKey: key, productId: null, payload });
  const res = await callMicrostorePost<{ id?: number }>("/goods/add", body);
  if (res.err !== 0 || typeof res.id !== "number") {
    throw new Error(
      `Microstore /goods/add a refusé la création : ${res.msg || res.debug_msg || `err=${res.err}`}`,
    );
  }
  return { microstoreProductId: res.id };
}

/**
 * Lit une fiche produit Microstore. Utile pour :
 *  - le backfill (retrouver `microstoreProductId` + `microstoreVariantId` par item_ref) ;
 *  - récupérer les `sku.id` avant un update (les SKUs préservés doivent porter leur id).
 */
export async function microstoreGetGoods(
  microstoreProductId: number,
): Promise<MicrostoreGoodsInfo | null> {
  const key = await getMicrostoreSessionKey();
  if (!key) throw new MicrostoreSessionExpiredError();

  const body = new URLSearchParams({
    key,
    id: String(microstoreProductId),
    cover_color: "0",
    app_version: "2.76.21",
    app_pid: "91",
    api_version: "1.0",
    lang: "en",
  });
  const res = await callMicrostorePost<{ info?: MicrostoreGoodsInfo }>(
    "/goods/get",
    body,
  );
  if (res.err !== 0) return null;
  return res.info ?? null;
}

/**
 * Met à jour un produit existant côté Microstore.
 *
 * ⚠ Les SKU à préserver DOIVENT porter leur `id` Microstore (sinon
 * err=9999 "same sku but no id"). Les SKU nouveaux (sans `id`) sont créés.
 * Les SKU à supprimer sont listés dans `deleteVariantIds` (bascule vers
 * `del_id=[...]` côté API).
 */
export async function microstoreUpdateGoods(opts: {
  microstoreProductId: number;
  payload: MicrostoreGoodsPayload;
  deleteVariantIds?: number[];
}): Promise<void> {
  const key = await getMicrostoreSessionKey();
  if (!key) throw new MicrostoreSessionExpiredError();

  const body = buildGoodsFormBody({
    sessionKey: key,
    productId: opts.microstoreProductId,
    payload: opts.payload,
    deleteVariantIds: opts.deleteVariantIds,
  });
  const res = await callMicrostorePost<Record<string, unknown>>(
    "/goods/update",
    body,
  );
  if (res.err !== 0) {
    throw new Error(
      `Microstore /goods/update a refusé la mise à jour : ${res.msg || res.debug_msg || `err=${res.err}`}`,
    );
  }
}

/**
 * Supprime une ou plusieurs variantes d'un produit Microstore, en conservant
 * les autres SKUs à l'identique.
 *
 * Sous-jacent : appelle /goods/update avec `del_id=[...]` et la liste des
 * SKUs à préserver reconstituée depuis /goods/get. C'est le seul mécanisme
 * exposé par Microstore pour supprimer un SKU (pas d'endpoint dédié).
 */
/**
 * Désactive (ou réactive) un produit côté Microstore. C'est le pendant API du
 * bouton "Masquer/Afficher" de l'appli mobile MC Gérant. La fiche reste en
 * base mais disparaît de la vitrine H5.
 *
 * @param disabled  true = masquer (`disable=1`), false = ré-afficher (`disable=0`).
 */
export async function microstoreDisableGoods(opts: {
  microstoreProductId: number;
  disabled: boolean;
}): Promise<void> {
  const key = await getMicrostoreSessionKey();
  if (!key) throw new MicrostoreSessionExpiredError();

  const body = new URLSearchParams({
    key,
    id: String(opts.microstoreProductId),
    disable: opts.disabled ? "1" : "0",
    app_version: "2.76.21",
    app_pid: "91",
    api_version: "1.0",
    lang: "en",
  });
  const res = await callMicrostorePost<Record<string, unknown>>(
    "/goods/disable",
    body,
  );
  if (res.err !== 0) {
    throw new Error(
      `Microstore /goods/disable a refusé : ${res.msg || res.debug_msg || `err=${res.err}`}`,
    );
  }
}

/**
 * Supprime définitivement un produit côté Microstore (hard delete). Contrairement
 * à `microstoreDisableGoods`, la fiche est complètement retirée — l'ID Microstore
 * ne pointe plus vers rien après cet appel.
 *
 * Côté BJ, penser à remettre `Product.microstoreProductId = null` et
 * `ProductColor.microstoreVariantId = null` après suppression pour permettre
 * un re-push propre plus tard.
 */
export async function microstoreDeleteGoods(
  microstoreProductId: number,
): Promise<void> {
  const key = await getMicrostoreSessionKey();
  if (!key) throw new MicrostoreSessionExpiredError();

  const body = new URLSearchParams({
    key,
    id: String(microstoreProductId),
    app_version: "2.76.21",
    app_pid: "91",
    api_version: "1.0",
    lang: "en",
  });
  const res = await callMicrostorePost<Record<string, unknown>>(
    "/goods/del",
    body,
  );
  if (res.err !== 0) {
    throw new Error(
      `Microstore /goods/del a refusé : ${res.msg || res.debug_msg || `err=${res.err}`}`,
    );
  }
}

export async function microstoreDeleteVariants(opts: {
  microstoreProductId: number;
  deleteVariantIds: number[];
}): Promise<void> {
  if (opts.deleteVariantIds.length === 0) return;

  const info = await microstoreGetGoods(opts.microstoreProductId);
  if (!info) {
    throw new Error(
      `Produit Microstore #${opts.microstoreProductId} introuvable — suppression impossible.`,
    );
  }

  const toDelete = new Set(opts.deleteVariantIds);
  const preservedSkus: MicrostoreSkuInput[] = info.sku
    .filter((s) => !toDelete.has(Number(s.id)))
    .map((s, idx) => ({
      id: Number(s.id),
      color_id: s.color_id,
      color_name: s.color_name,
      color_alias: s.color_alias || "",
      stock: Number(s.num_1) || 0,
      price: Number(s.price_1) || Number(s.price) || 0,
      orderBy: Number(s.order_by ?? idx + 1),
      goodsSn: s.goods_sn,
      bhbStatus: Number(s.bhb_status),
    }));

  const payload: MicrostoreGoodsPayload = {
    itemRef: info.item_ref,
    name: info.name,
    desc: info.desc || "",
    price: Number(info.price) || 0,
    weightGrams: Number(info.weight) || 0,
    productCountry: info.product_country || "CN",
    remarkMaterial: info.remark_material || "",
    remarkPackage: Number(info.remark_package) || 1,
    catId: info.cat_id,
    brandId: info.brand_id || "0",
    yearId: info.year_id || "0",
    seasonId: info.season_id || "0",
    numPerPack: Number(info.num_per_pack) || 1,
    skus: preservedSkus,
  };

  await microstoreUpdateGoods({
    microstoreProductId: opts.microstoreProductId,
    payload,
    deleteVariantIds: opts.deleteVariantIds,
  });
}
