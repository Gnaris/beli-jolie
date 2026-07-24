/**
 * Microstore (Dokkr) API client — read-only.
 *
 * Endpoints utilisés :
 *  - GET /order/new_view_all → liste commandes (sans lignes)
 *  - GET /pluginsWeb/orderInfo/{id} → détail complet avec goods_info[]
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
  is_last: boolean;
  list_num: number;
  total_price: string;
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

/**
 * Liste les commandes Microstore sur une plage de dates.
 * Pagination : page + page_num (max 50 par page).
 *
 * NB : `bi_key` et `order_type` du HAR web.mc.app sont volontairement omis —
 * ils requièrent un contexte de session propre à la vraie UI web (registered
 * biKeys côté serveur, filtre "sale_order" restreint à 0). Sans ces filtres
 * on récupère la liste brute de tous les documents de vente sur la plage.
 */
export async function microstoreListOrders(opts: {
  fromDate: string; // "YYYY-MM-DD"
  toDate: string; // "YYYY-MM-DD"
  page?: number;
  pageSize?: number;
}): Promise<MicrostoreOrderListResponse> {
  const url = await buildMicrostoreUrl("/order/new_view_all", {
    page: String(opts.page ?? 1),
    page_num: String(opts.pageSize ?? 50),
    type: "custom",
    sday: opts.fromDate,
    eday: opts.toDate,
  });
  return callMicrostore<MicrostoreOrderListResponse>(url);
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
 */
export async function microstoreListAllOrders(opts: {
  fromDate: string;
  toDate: string;
  maxPages?: number;
}): Promise<MicrostoreOrderListItem[]> {
  const maxPages = opts.maxPages ?? 20; // sécurité : max 1000 orders
  const all: MicrostoreOrderListItem[] = [];
  for (let page = 1; page <= maxPages; page++) {
    const res = await microstoreListOrders({
      fromDate: opts.fromDate,
      toDate: opts.toDate,
      page,
      pageSize: 50,
    });
    all.push(...(res.list ?? []));
    if (res.is_last || (res.list?.length ?? 0) === 0) break;
  }
  return all;
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
