/**
 * Microstore (Dokkr) API client — read-only.
 *
 * Endpoints utilisés :
 *  - GET /order/new_view_all → liste commandes (sans lignes)
 *  - GET /pluginsWeb/orderInfo/{id} → détail complet avec goods_info[]
 *  - GET /customer/get_by_order → liste TOUS les clients (même sans commande)
 *  - GET /customer/search → recherche client par mot-clé (téléphone, id, nom)
 *
 * Toutes les fonctions nécessitent que `microstore_session_key` soit
 * configurée pour le tenant courant (voir lib/microstore-auth.ts).
 *
 * Détection d'expiration :
 *  - err 6011/6061/6001 → session expirée → propager MicrostoreSessionExpiredError
 *    → l'UI doit inviter à re-scanner un QR.
 */

import { buildMicrostoreUrl, isMicrostoreSessionExpiredError } from "@/lib/microstore-auth";
import { logger } from "@/lib/logger";

export class MicrostoreSessionExpiredError extends Error {
  constructor() {
    super("Session Microstore expirée. Reconnectez-vous via QR code.");
    this.name = "MicrostoreSessionExpiredError";
  }
}

async function callMicrostore<T>(url: string): Promise<T> {
  let res: Response;
  try {
    res = await fetch(url, {
      method: "GET",
      headers: {
        Accept: "application/json, text/plain, */*",
        Referer: "https://web.mc.app/",
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/150.0.0.0 Safari/537.36",
      },
      cache: "no-store",
    });
  } catch (err) {
    logger.error("[Microstore] network error", { error: err, url });
    throw new Error("Impossible de contacter Microstore.");
  }
  if (!res.ok) {
    throw new Error(`Microstore a répondu HTTP ${res.status}.`);
  }
  const data = (await res.json().catch(() => null)) as
    | ({ err?: number; msg?: string } & T)
    | null;
  if (!data) throw new Error("Réponse Microstore invalide.");
  if (isMicrostoreSessionExpiredError(data.err)) {
    throw new MicrostoreSessionExpiredError();
  }
  if (typeof data.err === "number" && data.err !== 0) {
    throw new Error(`Erreur Microstore (${data.err}) : ${data.msg || "?"}`);
  }
  return data;
}

// ─── Types API Microstore ────────────────────────────────────────────────

export interface MicrostoreOrderListItem {
  id: string;
  number: string;
  doc_sn: string;
  shop_id: string;
  shop_name: string;
  client_id: string;
  customer_name: string;
  calc_price: string; // "340.30"
  goods_quantity: string;
  shipping_name: string;
  shipping_price: string;
  pay_status: string; // "0" | "1"
  shipping_status: string; // "0" = pas expédié, "1" = partiel, "2" = tout expédié
  goods_status: number;
  remark: string;
  ctime: string; // unix seconds
  client_address_info?: {
    client_name: string;
    invoice_title?: string;
    company_name?: string;
    phone?: string;
    address?: string;
    zip?: string;
    city?: string;
    country?: string; // ISO alpha-2
  };
}

export interface MicrostoreOrderListResponse {
  err: number;
  list: MicrostoreOrderListItem[];
  /** 1 = dernière page, 0 = encore des pages après. L'API renvoie soit un
   *  number (0/1), soit un boolean. */
  is_last: number | boolean;
  /** Total commandes précis pour la plage demandée (identique sur toutes les
   *  pages — permet un pré-comptage avec `page_num=1`). */
  list_num: number;
  /** CA total pour la plage — présent UNIQUEMENT sur `page=1` (0.00 sur les
   *  pages suivantes). */
  total_price: string;
  /** Quantité totale d'articles vendus sur la plage (page=1 uniquement). */
  total_pack_num?: number;
  total_one_num?: number;
  /** TVA totale sur la plage (page=1 uniquement). */
  total_vat?: string;
  /** Répartition par niveau VIP (page=1 uniquement). */
  client_vip_total?: Array<{
    label: string;
    total_price: string;
    total_vat: string;
    total_quantity: string;
  }>;
}

export interface MicrostoreOrderDetailItem {
  id: string;
  goods_id: string;
  sku_id: string;
  price: string; // "5.20"
  pre_price: string;
  quantity: string; // "22"
  sale_sub_price: string; // "114.40000"
  receipt_goods_sn: string; // EAN
  goods_sn?: string;
  item_ref: string; // "V346"
  name: string;
  desc: string;
  img?: string;
  color_id?: string;
  color_name?: string;
  size_name?: string;
  remark_material?: string;
  category_name?: string;
  brand_name?: string;
  year_name?: string;
  season_name?: string;
}

export interface MicrostoreOrderDetail {
  id: string;
  number: string;
  total_price: string;
  paid_price: string;
  shipping_price: string;
  shipping_name: string;
  pay_status: string;
  shipping_status: string;
  remark: string;
  ctime: string;
  utime?: string;
  goods_info: MicrostoreOrderDetailItem[];
  client_info: {
    client_id: string;
    company_name?: string;
    first_name?: string;
    last_name?: string;
    phone?: string;
    phone_code?: string;
    email?: string;
    address?: string;
    address_name?: string;
    address_phone?: string;
    zip?: string;
    city?: string;
    country?: string; // "FRANCE"
    vat_num?: string;
    invoice_title?: string;
  };
  invoice_address?: {
    country_ISO?: string;
    email?: string;
  };
}

export interface MicrostoreOrderInfoResponse {
  err: number;
  data: {
    doc_info: MicrostoreOrderDetail;
  };
}

// ─── Fonctions publiques ─────────────────────────────────────────────────

const ORDER_LIST_SALE_ORDER_FILTER = JSON.stringify({
  options: ["sale_order"],
  allSelected: 0,
});

/**
 * Liste les commandes Microstore sur une plage de dates.
 * Pagination : `page` (1-indexé) + `pageSize` (100 recommandé, max validé HAR).
 *
 * Filtre STRICT sur les vraies commandes de vente via `order_type=sale_order` —
 * sinon l'API renvoie aussi les avoirs, factures, mouvements de stock, etc.
 * (bug historique corrigé 2026-08-01, cf. HAR `order mc.har`).
 *
 * Retour :
 *  - `list_num` : total commandes de la plage (précis dès la 1ère page)
 *  - `is_last` : 1 = dernière page
 *  - `total_price`, `total_vat`, `total_pack_num`, `client_vip_total[]` :
 *    stats globales, présentes uniquement sur `page=1`
 */
export async function microstoreListOrders(opts: {
  fromDate: string; // "YYYY-MM-DD"
  toDate: string; // "YYYY-MM-DD"
  page?: number;
  pageSize?: number;
}): Promise<MicrostoreOrderListResponse> {
  const url = await buildMicrostoreUrl("/order/new_view_all", {
    bi_key: "documentList",
    page: String(opts.page ?? 1),
    page_num: String(opts.pageSize ?? 100),
    type: "custom",
    sday: opts.fromDate,
    eday: opts.toDate,
    order_type: ORDER_LIST_SALE_ORDER_FILTER,
  });
  return callMicrostore<MicrostoreOrderListResponse>(url);
}

/**
 * Comptage rapide (sans transfert de payload) — appelle `page=1&page_num=1`
 * et renvoie `list_num`. Utilisé au démarrage du rattrapage historique pour
 * afficher un total précis dès le début du widget.
 *
 * Coût : 1 appel API, réponse ~2 Ko (1 commande + les compteurs).
 */
export async function microstoreCountOrders(opts: {
  fromDate: string;
  toDate: string;
}): Promise<{ total: number; totalPrice: string; totalVat: string; totalQuantity: number }> {
  const resp = await microstoreListOrders({
    fromDate: opts.fromDate,
    toDate: opts.toDate,
    page: 1,
    pageSize: 1,
  });
  return {
    total: resp.list_num ?? 0,
    totalPrice: resp.total_price ?? "0",
    totalVat: resp.total_vat ?? "0",
    totalQuantity: resp.total_pack_num ?? 0,
  };
}

/**
 * Détail complet d'une commande (avec les lignes goods_info).
 */
export async function microstoreGetOrderDetail(
  orderId: string,
): Promise<MicrostoreOrderDetail> {
  const url = await buildMicrostoreUrl(`/pluginsWeb/orderInfo/${orderId}`, {
    data_type: "json",
  });
  const res = await callMicrostore<MicrostoreOrderInfoResponse>(url);
  if (!res.data?.doc_info) {
    throw new Error("Commande Microstore introuvable.");
  }
  return res.data.doc_info;
}

/**
 * Récupère toutes les commandes d'une plage (auto-pagination).
 * Attention : peut faire plusieurs appels — utiliser avec des dates courtes.
 *
 * **Important** : l'API `/order/new_view_all` renvoie parfois `pageSize + 1`
 * items par page (1 de plus pour signaler "next page dispo") — on tronque
 * à `pageSize` pour éviter le double-comptage (bug 1068/1059 corrigé 2026-08-01).
 */
export async function microstoreListAllOrders(opts: {
  fromDate: string;
  toDate: string;
  maxPages?: number;
}): Promise<MicrostoreOrderListItem[]> {
  const maxPages = opts.maxPages ?? 200; // sécurité : 20 000 commandes max
  const pageSize = 100;
  const all: MicrostoreOrderListItem[] = [];
  for (let page = 1; page <= maxPages; page++) {
    const res = await microstoreListOrders({
      fromDate: opts.fromDate,
      toDate: opts.toDate,
      page,
      pageSize,
    });
    const truncated = (res.list ?? []).slice(0, pageSize);
    all.push(...truncated);
    if (res.is_last || truncated.length === 0) break;
  }
  return all;
}

// ─── Types clients (customer/get_by_order + customer/search) ─────────────

/**
 * Item renvoyé par `/customer/get_by_order` — la liste basique n'inclut PAS
 * tous les champs (email, VAT, country, invoice). On y accède via
 * `/customer/search?keyword=...` ou via `client_info` du détail d'une commande.
 *
 * L'identifiant stable est `id` (ex "11374"), qu'on stocke dans
 * `AdminClientCard.microstoreClientId`. Le téléphone est plus fragile
 * (peut être vide, partagé, changé) — on ne l'utilise pas comme clé.
 */
export interface MicrostoreCustomerListItem {
  id: string;
  add_id?: string;
  type?: string;
  name: string;
  vip?: string;
  is_premium?: string;
  disable?: string;
  phone?: string;
  address?: string;
  remark?: string;
  ctime?: string; // unix seconds, "0" pour les clients système
  debt?: string; // "0.00"
  goods_num?: number;
  currency_debt?: string;
  currency_symbol?: string;
  client_shop_id?: string[];
}

export interface MicrostoreCustomerListResponse {
  err: number;
  msg?: string;
  list: MicrostoreCustomerListItem[];
  /** Total de clients (précis dès la 1ère page). */
  list_num: number;
  /** 1 = dernière page, 0 = encore des pages après. */
  is_last: number;
  vip_num?: Array<{ vip: string; num: string }>;
  premium_num?: number;
}

/**
 * Version enrichie du search — inclut email, country, VAT, invoice, etc.
 */
export interface MicrostoreCustomerSearchItem extends MicrostoreCustomerListItem {
  company_name?: string;
  country?: string;
  invoice_country?: string;
  invoice_title?: string;
  invoice_address?: string;
  invoice_zip?: string;
  city?: string;
  zip?: string;
  address_name?: string;
  address_phone?: string;
  detail_address?: string;
  tel?: string;
  fax?: string;
  vat_num?: string;
  vat_number?: string;
  tax_number?: string;
  member_num?: string;
  vip_card_no?: string;
  tags?: unknown[];
}

// ─── Fonctions publiques — clients ───────────────────────────────────────

const CUSTOMER_LIST_STATUS_ENABLED_ONLY = JSON.stringify({
  options: ["disable=0"],
  allSelected: 0,
});

/**
 * Liste les clients Microstore (dont ceux qui n'ont jamais commandé).
 *
 * Pagination :
 *  - `page` : 1-indexé
 *  - `pageNum` : 20 / 50 / 100 (100 recommandé)
 *
 * Retour :
 *  - `list_num` = total connu dès la 1ère page → parfait pour une progress bar
 *  - `is_last` = 1 quand on a atteint la fin
 *  - `list` peut contenir `pageNum + 1` items (l'API retourne 1 de plus pour
 *    signaler "prochaine page dispo"). On tronque à `pageNum` côté sync pour
 *    éviter le double comptage.
 */
export async function microstoreListCustomers(opts: {
  page?: number;
  pageNum?: number;
}): Promise<MicrostoreCustomerListResponse> {
  const url = await buildMicrostoreUrl("/customer/get_by_order", {
    bi_key: "clientList",
    days: "-1",
    order: "utime",
    isasc: "0",
    page: String(opts.page ?? 1),
    page_num: String(opts.pageNum ?? 100),
    client_status: CUSTOMER_LIST_STATUS_ENABLED_ONLY,
    type: "1",
  });
  return callMicrostore<MicrostoreCustomerListResponse>(url);
}

/**
 * Recherche un client par mot-clé (téléphone, id, nom).
 * Utilisé comme fallback quand un `client_id` de commande ne matche aucune
 * fiche déjà importée (rare : client créé entre la passe clients et la passe
 * commandes du rattrapage historique).
 *
 * Renvoie des items enrichis (email, country, VAT, etc.) — plus complets
 * que ceux de `microstoreListCustomers`.
 */
export async function microstoreSearchCustomer(opts: {
  keyword: string;
  page?: number;
  pageNum?: number;
}): Promise<{
  err: number;
  msg?: string;
  list: MicrostoreCustomerSearchItem[];
  list_num: number;
  is_last: number;
}> {
  const url = await buildMicrostoreUrl("/customer/search", {
    client_type: "1",
    bi_key: "clientList",
    days: "-1",
    order: "utime",
    isasc: "0",
    keyword: opts.keyword,
    page: String(opts.page ?? 1),
    page_num: String(opts.pageNum ?? 100),
    client_status: CUSTOMER_LIST_STATUS_ENABLED_ONLY,
  });
  return callMicrostore<{
    err: number;
    msg?: string;
    list: MicrostoreCustomerSearchItem[];
    list_num: number;
    is_last: number;
  }>(url);
}

// ─── Utilitaires normalisation ───────────────────────────────────────────

/**
 * Mappe les statuts Microstore (goods_status/shipping_status) vers notre enum.
 */
export function microstoreMapStatus(input: {
  shippingStatus: string | number;
  goodsStatus?: number;
}): "NEW" | "SHIPPED" | "CANCELLED" {
  const ship = Number(input.shippingStatus ?? 0);
  // Pour l'instant, pas de cas d'annulation dans les samples — on garde NEW/SHIPPED.
  // TODO : ajouter détection CANCELLED si Microstore expose ce champ.
  if (ship >= 2) return "SHIPPED";
  return "NEW";
}

/**
 * Convertit un nom de pays Microstore ("FRANCE", "SPAIN"…) en ISO alpha-2
 * ("FR", "ES"…). Retourne null si inconnu.
 */
export function microstoreCountryToIso(country: string | undefined | null): string | null {
  if (!country) return null;
  const c = country.trim().toUpperCase();
  if (!c) return null;
  // Certains champs sont déjà en ISO ("FR", "BE"…), les autres en nom plein.
  if (c.length === 2) return c;
  const map: Record<string, string> = {
    FRANCE: "FR",
    BELGIUM: "BE",
    BELGIQUE: "BE",
    SWITZERLAND: "CH",
    SUISSE: "CH",
    LUXEMBOURG: "LU",
    SPAIN: "ES",
    ESPAGNE: "ES",
    ITALY: "IT",
    ITALIE: "IT",
    GERMANY: "DE",
    ALLEMAGNE: "DE",
    "UNITED KINGDOM": "GB",
    PORTUGAL: "PT",
    NETHERLANDS: "NL",
    "PAYS-BAS": "NL",
    "PAYS BAS": "NL",
  };
  return map[c] ?? null;
}
