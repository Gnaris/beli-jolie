/**
 * Faire — API commandes (lecture seule)
 *
 * Wrappers HTTP typés pour :
 *   - GET /external-api/v2/orders?page=X&limit=N  → liste paginée
 *   - GET /external-api/v2/orders/{orderId}       → détail complet
 *
 * Faire tarifie tout en **centimes** dans une unique devise (généralement EUR
 * pour les brands européennes) — voir docs/faire-api.md §14.
 *
 * Faire ne fournit AUCUN webhook (§13) : polling seul via
 * `lib/faire-orders-worker.ts` (tick 5 min).
 *
 * Contrainte stricte : `limit` doit être entre 10 et 50, sinon HTTP 400 explicite.
 *
 * ⚠️ LECTURE SEULE. Aucune action destructive (accept / cancel / ship) ici.
 */

import { faireFetch } from "@/lib/faire-api";
import { logger } from "@/lib/logger";

// ─────────────────────────────────────────────
// Types — commandes Faire
// ─────────────────────────────────────────────

/**
 * Statuts bruts observés côté Faire (doc §11.2).
 * Liste non exhaustive — Faire peut ajouter d'autres statuts, on garde String.
 */
export type FaireOrderStatusRaw =
  | "NEW"
  | "PROCESSING"
  | "BACKORDERED"
  | "SHIPPED"
  | "DELIVERED"
  | "CANCELLED"
  | string;

export interface FaireOrderAddress {
  name?: string | null;
  company_name?: string | null;
  address1?: string | null;
  address2?: string | null;
  city?: string | null;
  state?: string | null;
  state_code?: string | null;
  postal_code?: string | null;
  country?: string | null;
  country_code?: string | null; // ISO 3166-1 alpha-2
  phone_number?: string | null;
}

export interface FaireOrderDiscount {
  type?: string | null;
  amount_cents?: number | null;
  code?: string | null;
}

export interface FaireMoney {
  amount_minor: number; // en centimes (ou l'équivalent minor unit de la devise)
  currency?: string; // "EUR", "USD"…
}

export interface FaireOrderItemResource {
  id: string; // "oi_1"
  product_id?: string | null; // "p_abc"
  product_option_id?: string | null; // "po_456"
  variant_id?: string | null; // alias historique de product_option_id
  product_name?: string | null;
  product_option_name?: string | null; // ex "Or / S"
  variant_name?: string | null; // alias historique
  sku?: string | null; // ex "BJ-BRC-001-OR-S"
  quantity: number;
  /** ⚠️ Deprecated depuis la refonte 2024 : Faire renvoie `0` — utiliser `price.amount_minor`. */
  price_cents?: number | null;
  price?: FaireMoney | null;
  discounts?: FaireOrderDiscount[] | null;
  includes_tester?: boolean | null;
  tester_price_cents?: number | null;
  tester_price?: FaireMoney | null;
}

export interface FaireShipmentTrackingEvent {
  status?: string | null;
  timestamp?: string | null;
}

export interface FaireShipmentResource {
  id?: string | null;
  carrier?: string | null;
  tracking_code?: string | null;
  tracking_url?: string | null;
  shipped_at?: string | null;
  items?: Array<{ id?: string; quantity?: number }> | null;
  tracking_events?: FaireShipmentTrackingEvent[] | null;
}

export interface FairePayoutCosts {
  /** ⚠️ Deprecated : Faire renvoie `0` — utiliser `payout_fee.amount_minor`. */
  payout_fee_cents?: number | null;
  payout_fee?: FaireMoney | null;
  payout_fee_bps?: number | null;
  /** ⚠️ Deprecated : Faire renvoie `0` — utiliser `commission.amount_minor`. */
  commission_cents?: number | null;
  commission?: FaireMoney | null;
  commission_bps?: number | null;
}

/**
 * Extrait un montant en centimes à partir d'un des 2 formats Faire :
 * - Nouveau : `{ amount_minor: N }`
 * - Deprecated : champ `_cents: N` direct
 * Prend d'abord `amount_minor` (source de vérité actuelle) puis fallback.
 */
export function faireMoneyToCents(
  money: FaireMoney | null | undefined,
  legacyCents: number | null | undefined,
): number {
  if (money && typeof money.amount_minor === "number") return money.amount_minor;
  if (typeof legacyCents === "number") return legacyCents;
  return 0;
}

export interface FaireOrderResource {
  id: string; // "bo_orderabc"
  display_id?: string | null; // "ORD-12345"
  state: FaireOrderStatusRaw; // "NEW" | "PROCESSING" | …
  source?: string | null; // "FAIRE" | "FAIRE_DIRECT"
  retailer_id?: string | null; // "r_xyz"
  currency?: string | null; // "EUR"

  ship_after?: string | null;
  created_at: string;
  updated_at?: string | null;
  canceled_at?: string | null;

  items?: FaireOrderItemResource[] | null;
  shipments?: FaireShipmentResource[] | null;
  address?: FaireOrderAddress | null;
  payout_costs?: FairePayoutCosts | null;
}

export interface FaireOrderListResponse {
  page?: number;
  limit?: number;
  orders: FaireOrderResource[];
}

// ─────────────────────────────────────────────
// Contraintes de pagination Faire (doc §11.1)
// ─────────────────────────────────────────────

const MIN_ORDER_LIMIT = 10;
const MAX_ORDER_LIMIT = 50;

function clamp(n: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, Math.floor(n)));
}

// ─────────────────────────────────────────────
// Wrappers HTTP
// ─────────────────────────────────────────────

/**
 * Liste paginée des commandes Faire.
 *
 * @param page  1-based (défaut 1)
 * @param limit clampé à [10, 50] par Faire — 50 par défaut
 * @param updatedAtMin filtre optionnel ISO 8601 (recommandé pour l'incrémental)
 * @param excludedStates ex `["DELIVERED"]` pour n'écouter que les commandes actives
 */
export async function faireListOrders(
  page = 1,
  limit = 50,
  updatedAtMin?: string,
  excludedStates?: FaireOrderStatusRaw[],
): Promise<FaireOrderListResponse> {
  const safeLimit = clamp(limit, MIN_ORDER_LIMIT, MAX_ORDER_LIMIT);
  const safePage = Math.max(1, Math.floor(page));

  const params = new URLSearchParams();
  params.set("page", String(safePage));
  params.set("limit", String(safeLimit));
  if (updatedAtMin) params.set("updated_at_min", updatedAtMin);
  for (const state of excludedStates ?? []) {
    params.append("excluded_states", state);
  }

  const res = await faireFetch(`/orders?${params.toString()}`);
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    logger.error("[Faire Orders] listOrders failed", {
      page: safePage,
      limit: safeLimit,
      status: res.status,
      body: text.slice(0, 300),
    });
    throw new Error(`Faire listOrders HTTP ${res.status}`);
  }

  const json = (await res.json()) as Partial<FaireOrderListResponse> & {
    orders?: FaireOrderResource[] | null;
  };
  return {
    page: json.page ?? safePage,
    limit: json.limit ?? safeLimit,
    orders: json.orders ?? [],
  };
}

/**
 * Récupère le détail d'une commande Faire par son ID ("bo_xxx"). Retourne null si 404.
 */
export async function faireGetOrder(id: string): Promise<FaireOrderResource | null> {
  const res = await faireFetch(`/orders/${encodeURIComponent(id)}`);
  if (res.status === 404) return null;
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    logger.error("[Faire Orders] getOrder failed", {
      id,
      status: res.status,
      body: text.slice(0, 300),
    });
    throw new Error(`Faire getOrder HTTP ${res.status}`);
  }
  return (await res.json()) as FaireOrderResource;
}

// ─────────────────────────────────────────────
// Utilitaires
// ─────────────────────────────────────────────

/**
 * Statut unifié Beli & Jolie (partagé avec PFS/eFashion/Ankorstore) à partir
 * du statut brut Faire.
 *
 * ⚠️ La doc Faire §11.2 liste `NEW | PROCESSING | SHIPPED | CANCELLED |
 * BACKORDERED | DELIVERED`, mais dans la réalité l'API renvoie aussi
 * `PRE_TRANSIT` (expédiée, avant scan transporteur), `IN_TRANSIT` (livraison
 * en cours) et `CANCELED` (orthographe américaine, un seul L). Confirmé sur
 * les commandes prod 2026-07 — voir tickets internes.
 */
export function normalizeFaireStatus(
  raw: FaireOrderStatusRaw,
): "NEW" | "SHIPPED" | "CANCELLED" {
  switch (raw) {
    case "SHIPPED":
    case "DELIVERED":
    case "PRE_TRANSIT": // Étiquette imprimée, colis prêt à partir
    case "IN_TRANSIT": // En cours de livraison
      return "SHIPPED";
    case "CANCELLED":
    case "CANCELED":
      return "CANCELLED";
    default:
      // NEW, PROCESSING, BACKORDERED et tout statut inconnu → NEW
      return "NEW";
  }
}

/** Convertit une valeur en centimes en euros (nombre à 2 décimales). */
export function faireCentsToEuros(cents: number | null | undefined): number {
  if (cents == null || !Number.isFinite(cents)) return 0;
  return Math.round(cents) / 100;
}

/**
 * Extrait la « référence base » (identifiant produit BJ) depuis un SKU Faire.
 * Convention Beli & Jolie : `{referenceBJ}-{couleur}-{taille}` ou
 * `{referenceBJ}_{couleur}_{taille}` — on garde le 1ᵉʳ segment avant `-` ou `_`.
 * Retourne null si le SKU est vide.
 */
export function extractReferenceFromFaireSku(sku: string | null | undefined): string | null {
  if (!sku) return null;
  const trimmed = String(sku).trim();
  if (!trimmed) return null;
  const idx = trimmed.search(/[-_]/);
  return idx > 0 ? trimmed.slice(0, idx) : trimmed;
}

/**
 * Calcule le total HT d'une commande Faire à partir de ses items.
 * Faire ne fournit pas de champ `total_cents` global — c'est notre calcul canonique.
 *
 * ⚠️ Faire renvoie systématiquement `price_cents: 0` depuis la refonte 2024 et
 * expose le vrai prix dans `price.amount_minor`. On lit `amount_minor` en
 * priorité, avec fallback sur `price_cents` pour compat rétro.
 */
export function computeFaireOrderTotalCents(items: FaireOrderItemResource[] | null | undefined): number {
  if (!items?.length) return 0;
  let total = 0;
  for (const it of items) {
    const priceCents = faireMoneyToCents(it.price, it.price_cents);
    const qty = it.quantity ?? 0;
    total += priceCents * qty;
  }
  return total;
}

/** Prix unitaire d'un item Faire en centimes (nouveau ou legacy). */
export function getFaireItemUnitPriceCents(it: FaireOrderItemResource): number {
  return faireMoneyToCents(it.price, it.price_cents);
}

/**
 * Extrait la meilleure info de tracking à partir des shipments (dernier
 * shipment non vide). Retourne { carrier, code, url, shippedAt } ou tout à null.
 *
 * Note : Faire n'expose pas de `shipped_at` distinct sur le shipment — on
 * retombe sur `created_at` (moment où la marque a déclaré l'expédition).
 */
export function extractFaireTrackingInfo(
  shipments: FaireShipmentResource[] | null | undefined,
): {
  carrier: string | null;
  trackingCode: string | null;
  trackingUrl: string | null;
  shippedAt: string | null;
} {
  const empty = { carrier: null, trackingCode: null, trackingUrl: null, shippedAt: null };
  if (!shipments?.length) return empty;
  // Dernier shipment avec un tracking_code (ordre de la réponse = chronologique)
  for (let i = shipments.length - 1; i >= 0; i--) {
    const s = shipments[i] as FaireShipmentResource & { created_at?: string | null };
    if (s?.tracking_code || s?.carrier) {
      return {
        carrier: s.carrier ?? null,
        trackingCode: s.tracking_code ?? null,
        trackingUrl: s.tracking_url ?? null,
        shippedAt: s.shipped_at ?? s.created_at ?? null,
      };
    }
  }
  return empty;
}
