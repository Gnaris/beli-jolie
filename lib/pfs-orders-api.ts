/**
 * PFS (Paris Fashion Shop) — API commandes (lecture seule)
 *
 * Wrappers HTTP typés pour :
 *   - GET /orders/listOrders?page=X&per_page=50 → résumé paginé
 *   - GET /orders/{orderId}                     → détail complet
 *
 * Utilise la même authent + retry que `lib/pfs-api.ts`.
 */

import { getPfsHeaders, PFS_BASE_URL } from "@/lib/pfs-auth";
import { fetchWithRetry } from "@/lib/pfs-api";

// ─────────────────────────────────────────────
// Types — réponse LIST
// ─────────────────────────────────────────────

export type PfsOrderStatusRaw =
  | "NEW"
  | "VALIDATED"
  | "SENT"
  | "CANCELLED"
  | string; // fallback si PFS ajoute un nouveau statut

export interface PfsListOrderSummary {
  id: string; // "ord_..."
  order_no: string; // "PO#42759407"
  creation_date: string; // "YYYY-MM-DD HH:mm:ss" (Europe/Paris)
  customer: string; // Nom société brut ("BDB MAKEUP")
  country: string | null; // ISO-2
  order_vat: number | null; // Montant TTC commandé
  validated_vat: number | null; // Montant TTC validé (après retrait des ruptures)
  pfs_payment_date: string | null;
  status: PfsOrderStatusRaw;
  transporter: string | null;
  has_invoice: 0 | 1;
  has_credit: 0 | 1;
}

export interface PfsOrdersState {
  total: number;
  count_new: number;
  count_validated: number;
  count_sent: number;
  count_cancelled: number;
  count_todo_invoice?: number;
  count_todo_credit?: number;
  total_validated_sales_vat: number;
  total_validated_sales_non_vat: number;
  total_lost_sales_vat?: number;
  total_lost_sales_non_vat?: number;
  avg_basket_vat?: number;
  avg_basket_non_vat?: number;
  count_exported?: number;
}

export interface PfsPaginationMeta {
  current_page: number;
  from: number | null;
  last_page: number;
  per_page: number;
  to: number | null;
  total: number;
}

export interface PfsListOrdersResponse {
  data: PfsListOrderSummary[];
  state: PfsOrdersState;
  links: { first?: string; last?: string; prev?: string | null; next?: string | null };
  meta: PfsPaginationMeta;
}

// ─────────────────────────────────────────────
// Types — réponse DÉTAIL
// ─────────────────────────────────────────────

export interface PfsOrderDetailCustomer {
  id: string; // ID PFS unique du client — clé de rattachement
  name: string;
  shop: string | null;
  phone: string | null;
  identification_numbers: {
    siret?: string | null;
    vat?: string | null;
    eori?: string | null;
  } | null;
  payment_method: string | null;
  carrier: {
    value: string;
    labels?: Record<string, string>;
  } | null;
  delivery_address: PfsAddress | null;
  billing_address: PfsAddress | null;
}

export interface PfsAddress {
  street?: string | null;
  postal_code?: string | null;
  city?: string | null;
  country?: string | null;
}

export interface PfsOrderDetailSummary {
  subtotal_excl_tax: number;
  total_incl_tax: number;
  vat: {
    rate: number;
    amount: number;
  };
  refund_incl_tax: number | null;
  discounts: unknown[];
}

export interface PfsOrderTimelineEntry {
  status: PfsOrderStatusRaw;
  timestamp: string; // ISO
  payment_method?: string;
}

export interface PfsOrderDetailItem {
  id: string;
  variant_id: string | null;
  sku: string; // "A1623E_GOLDEN_TU"
  sku_without_ref?: string | null;
  type: "ITEM" | "PACK" | string;
  pieces: number;
  size_details_tu?: string | null;
  qty_ordered: number;
  qty_validated: number;
  price_sale: {
    unit: { value: number; currency: string };
    total: { value: number; currency: string };
    total_with_qty?: { value: number; currency: string };
  };
  price_before_discount?: {
    unit: { value: number; currency: string };
    total: { value: number; currency: string };
  };
  color: {
    id: number;
    reference: string;
    labels: Record<string, string>;
  } | null;
  item?: {
    color: unknown;
    size: string;
  };
  stock_qty?: number;
  weight?: number;
  discounts?: unknown[];
}

export interface PfsOrderDetailProduct {
  id: string; // "pro_..."
  reference: string; // "A1623E"
  gender?: unknown;
  category?: unknown;
  family?: unknown;
  total_ordered_qty: number;
  total_validated_qty: number;
  total_ordered_price: number;
  total_validated_price: number;
  items: PfsOrderDetailItem[];
}

export interface PfsOrderDetailBrandBucket {
  id: string;
  name: string;
  products: PfsOrderDetailProduct[];
}

export interface PfsOrderDetail {
  id: string;
  order_no: string;
  created_at: string; // ISO
  status: PfsOrderStatusRaw;
  canceled_at: string | null;
  total_weight: number | null;
  total_ordered_qty: number;
  total_validated_qty: number;
  validated: { pieces: number; packs: number };
  order_vat: number;
  validated_vat: number;
  has_invoice: 0 | 1;
  has_credit: 0 | 1;
  has_consignment_note?: boolean;
  unique_references: number;
  customer: PfsOrderDetailCustomer;
  summary: PfsOrderDetailSummary;
  status_timeline: PfsOrderTimelineEntry[];
  items_by_brand: PfsOrderDetailBrandBucket[];
}

export interface PfsOrderDetailResponse {
  success: boolean;
  message: string;
  meta: unknown;
  data: PfsOrderDetail;
}

// ─────────────────────────────────────────────
// Endpoints
// ─────────────────────────────────────────────

export interface PfsListOrdersOptions {
  page: number;
  perPage?: number;
}

/** GET /orders/listOrders — résumé paginé, 50 par défaut (max côté PFS). */
export async function pfsListOrders(
  opts: PfsListOrdersOptions,
): Promise<PfsListOrdersResponse> {
  const params = new URLSearchParams({
    page: String(opts.page),
    per_page: String(opts.perPage ?? 50),
  });
  const url = `${PFS_BASE_URL}/orders/listOrders?${params}`;
  const headers = await getPfsHeaders();
  const res = await fetchWithRetry(url, { method: "GET", headers });
  return (await res.json()) as PfsListOrdersResponse;
}

/** GET /orders/{orderId} — détail complet (client, adresses, articles, timeline). */
export async function pfsGetOrderDetail(orderId: string): Promise<PfsOrderDetail> {
  const url = `${PFS_BASE_URL}/orders/${encodeURIComponent(orderId)}`;
  const headers = await getPfsHeaders();
  const res = await fetchWithRetry(url, { method: "GET", headers });
  const body = (await res.json()) as PfsOrderDetailResponse;
  return body.data;
}

// ─────────────────────────────────────────────
// Helpers de normalisation
// ─────────────────────────────────────────────

/** Parse "YYYY-MM-DD HH:mm:ss" (Europe/Paris) → Date UTC. */
export function parsePfsListDate(raw: string): Date {
  // PFS renvoie une date locale sans TZ ; on l'interprète en Europe/Paris.
  // Pour éviter d'introduire une dépendance timezone-lourde, on parse en UTC
  // puis on applique un offset fixe (approximation acceptable : les stats
  // s'affichent en fr-FR côté UI et perdent 1-2h de dérive DST 2×/an).
  const iso = raw.replace(" ", "T") + "Z";
  return new Date(iso);
}

/** Statut PFS → notre enum interne. */
export function normalizePfsStatus(raw: PfsOrderStatusRaw): "NEW" | "VALIDATED" | "SENT" | "CANCELLED" {
  const upper = String(raw ?? "").toUpperCase();
  if (upper === "VALIDATED") return "VALIDATED";
  if (upper === "SENT") return "SENT";
  if (upper === "CANCELLED" || upper === "CANCELED") return "CANCELLED";
  return "NEW";
}
