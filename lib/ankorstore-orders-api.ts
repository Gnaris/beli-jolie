/**
 * Ankorstore — API commandes (lecture seule)
 *
 * Wrappers HTTP typés pour :
 *   - GET /orders?page[limit]=N&page[after]=UUID → liste paginée (curseur)
 *   - GET /orders/{orderId}?include=…            → détail complet
 *
 * L'API Ankorstore commandes suit la convention **JSON:API** : chaque ressource
 * est enveloppée dans `{ data: [{ type, id, attributes, relationships }], included: […] }`.
 * La pagination est par curseur UUID (pas offset) : `meta.page.to` sert d'ancre
 * pour la page suivante via `page[after]`.
 *
 * Utilise la même auth OAuth2 et retry que `lib/ankorstore-api.ts` — on ne peut
 * pas réutiliser directement `ankorstoreFetch` (privé au module), donc on
 * réimplémente le retry local avec 401→refresh token.
 *
 * ⚠️ LECTURE SEULE : aucun POST/PATCH/DELETE. Toutes les actions destructives
 * (accept/reject/expédition) restent hors périmètre de ce module.
 */

import {
  ANKORSTORE_BASE_URL,
  getAnkorstoreHeaders,
  invalidateAnkorstoreToken,
} from "@/lib/ankorstore-auth";
import { logger } from "@/lib/logger";

// ─────────────────────────────────────────────
// Types — Ankorstore Orders (JSON:API)
// ─────────────────────────────────────────────

/** Statuts bruts observés côté Ankorstore. Liste non-exhaustive : garder String. */
export type AnkorstoreOrderStatusRaw =
  | "submitted"
  | "ankor_confirmed"
  | "brand_confirmed"
  | "brand_paid"
  | "retailer_paid"
  | "shipped"
  | "delivered"
  | "cancelled"
  | "rejected"
  | string;

export interface AnkorstoreJsonApiRef {
  type: string;
  id: string;
}

export interface AnkorstoreJsonApiRel {
  data: AnkorstoreJsonApiRef | AnkorstoreJsonApiRef[] | null;
}

export interface AnkorstoreOrderAttributes {
  masterOrderId?: string | null;
  status: AnkorstoreOrderStatusRaw;
  brandCurrency: string; // "EUR"
  reference: string; // "4930569"

  // Montants en centimes
  brandNetAmount: number;
  brandTotalAmount: number;
  brandTotalAmountVat: number;
  brandTotalAmountWithVat: number;

  brandRejectReason?: string | null;
  retailerRejectReason?: string | null;
  retailerCancellationRequestReason?: string | null;

  billingName?: string | null;
  billingOrganisationName?: string | null;
  billingStreet?: string | null;
  billingPostalCode?: string | null;
  billingCity?: string | null;
  billingCountryCode?: string | null;

  submittedAt?: string | null;
  shippedAt?: string | null;
  brandPaidAt?: string | null;
  createdAt: string;
  updatedAt?: string | null;
  cancelledAt?: string | null;

  shippingMethod?: string | null;
  shippingOverview?: AnkorstoreShippingOverview | null;
}

export interface AnkorstoreShippingOverview {
  shipToAddress?: {
    name?: string | null;
    organisationName?: string | null;
    street?: string | null;
    city?: string | null;
    postalCode?: string | null;
    countryCode?: string | null;
  } | null;
  provider?: string | null;
  tracking?: {
    number?: string | null;
    link?: string | null;
  } | null;
  parcels?: Array<{
    trackedPackage?: {
      trackingNumber?: string | null;
      trackingLink?: string | null;
      currentStatus?: {
        status?: string | null;
        statusDetails?: string | null;
        updatedAt?: string | null;
        location?: {
          city?: string | null;
          state?: string | null;
          zip?: string | null;
          country?: string | null;
        } | null;
      } | null;
    } | null;
  }> | null;
  transaction?: {
    tracking?: {
      trackingNumber?: string | null;
      trackingLink?: string | null;
      currentStatus?: {
        status?: string | null;
        statusDetails?: string | null;
        updatedAt?: string | null;
      } | null;
    } | null;
  } | null;
}

export interface AnkorstoreOrderResource {
  type: "orders";
  id: string;
  attributes: AnkorstoreOrderAttributes;
  relationships?: {
    retailer?: AnkorstoreJsonApiRel;
    billingItems?: AnkorstoreJsonApiRel;
    orderItems?: AnkorstoreJsonApiRel;
  };
}

export interface AnkorstoreRetailerAttributes {
  companyName?: string | null;
  storeName?: string | null;
  storeUrl?: string | null;
  email?: string | null;
  firstName?: string | null;
  lastName?: string | null;
  taxNumber?: string | null;
  vatNumber?: string | null;
  eoriNumber?: string | null;
  phoneNumberE164?: string | null;
  businessIdentifier?: string | null;
  createdAt?: string | null;
  updatedAt?: string | null;
}

export interface AnkorstoreRetailerResource {
  type: "retailers";
  id: string;
  attributes: AnkorstoreRetailerAttributes;
}

export interface AnkorstoreOrderItemAttributes {
  brandCurrency: string;
  quantity: number;
  multipliedQuantity: number;
  vatRate: number;
  brandAmount: number; // centimes
  brandAmountVat: number;
  brandAmountWithVat: number;
  brandUnitPrice: number;
  createdAt?: string | null;
  updatedAt?: string | null;
}

export interface AnkorstoreOrderItemResource {
  type: "order-items";
  id: string;
  attributes: AnkorstoreOrderItemAttributes;
  relationships?: {
    productVariant?: AnkorstoreJsonApiRel;
  };
}

export interface AnkorstoreProductVariantAttributes {
  name?: string | null;
  sku?: string | null;
  ian?: string | null;
  optionLabel?: string | null;
  retailPrice?: number | null;
  wholesalePrice?: number | null;
  archivedAt?: string | null;
  images?: Array<{ order: number; url: string }> | null;
}

export interface AnkorstoreProductVariantResource {
  type: "productVariants";
  id: string;
  attributes: AnkorstoreProductVariantAttributes;
  relationships?: {
    product?: AnkorstoreJsonApiRel;
  };
}

export interface AnkorstoreProductResourceAttributes {
  name?: string | null;
  description?: string | null;
  language?: string | null;
  active?: boolean | null;
  archived?: boolean | null;
  retailPrice?: number | null;
  wholesalePrice?: number | null;
}

export interface AnkorstoreProductResource {
  type: "products";
  id: string;
  attributes: AnkorstoreProductResourceAttributes;
}

export interface AnkorstoreBillingItemAttributes {
  type: string; // "brand_payment_fees", "brand_flat_shipping_fees"…
  currency: string;
  vatRate: number;
  currencyRate: number;
  amount: number; // signé — centimes
  amountVat: number;
  amountWithVat: number;
  createdAt?: string | null;
  updatedAt?: string | null;
}

export interface AnkorstoreBillingItemResource {
  type: "billing-items";
  id: string;
  attributes: AnkorstoreBillingItemAttributes;
}

export type AnkorstoreIncludedResource =
  | AnkorstoreRetailerResource
  | AnkorstoreOrderItemResource
  | AnkorstoreProductVariantResource
  | AnkorstoreProductResource
  | AnkorstoreBillingItemResource
  | { type: string; id: string; attributes?: unknown; relationships?: unknown };

export interface AnkorstoreOrdersListResponse {
  data: AnkorstoreOrderResource[];
  included?: AnkorstoreIncludedResource[];
  meta?: {
    page?: {
      from?: string;
      to?: string;
      perPage?: number;
      hasMore?: boolean;
    };
  };
  links?: {
    first?: string;
    next?: string | null;
    prev?: string | null;
  };
}

export interface AnkorstoreOrderDetailResponse {
  data: AnkorstoreOrderResource;
  included?: AnkorstoreIncludedResource[];
}

// ─────────────────────────────────────────────
// HTTP helper avec retry + 401 refresh
// ─────────────────────────────────────────────

class AnkorstoreOrdersError extends Error {
  status?: number;
  constructor(message: string, status?: number) {
    super(message);
    this.name = "AnkorstoreOrdersError";
    this.status = status;
  }
}

async function ankorstoreGetJson<T>(path: string): Promise<T> {
  const url = `${ANKORSTORE_BASE_URL}${path}`;

  const doFetch = async (attempt: number): Promise<T> => {
    const headers = await getAnkorstoreHeaders();
    const res = await fetch(url, { method: "GET", headers });

    if (res.status === 401 && attempt === 0) {
      await invalidateAnkorstoreToken();
      logger.warn("[Ankorstore Orders] 401 → refresh token & retry", { path });
      return doFetch(1);
    }

    if (res.status === 429 && attempt < 3) {
      const retryAfter = Number(res.headers.get("retry-after")) || 2;
      const waitMs = Math.min(retryAfter * 1000, 10_000) * (attempt + 1);
      logger.warn("[Ankorstore Orders] 429 → wait & retry", { path, waitMs, attempt });
      await new Promise((r) => setTimeout(r, waitMs));
      return doFetch(attempt + 1);
    }

    // 504 upstream timeout — Ankor surchargé côté backend, souvent transitoire
    // sur les endpoints /orders avec includes profonds. Backoff exponentiel :
    // 2s, 4s, 8s. Après 3 tentatives, on remonte l'erreur.
    if (res.status === 504 && attempt < 3) {
      const waitMs = 2000 * Math.pow(2, attempt);
      logger.warn("[Ankorstore Orders] 504 upstream timeout → backoff & retry", {
        path,
        waitMs,
        attempt,
      });
      await new Promise((r) => setTimeout(r, waitMs));
      return doFetch(attempt + 1);
    }

    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new AnkorstoreOrdersError(
        `Ankorstore Orders HTTP ${res.status}: ${body.slice(0, 300)}`,
        res.status,
      );
    }

    return (await res.json()) as T;
  };

  return doFetch(0);
}

// ─────────────────────────────────────────────
// Endpoints
// ─────────────────────────────────────────────

export interface AnkorstoreListOrdersOptions {
  /** Nombre max de commandes par page (défaut 50, max côté API à valider). */
  limit?: number;
  /** Curseur UUID — retourne les commandes APRÈS cet ID (pour paginer). */
  after?: string | null;
  /** Filtrer par statut brut (ex "ankor_confirmed"). */
  status?: string;
  /**
   * Includes JSON:API : par défaut on pré-charge retailer + orderItems +
   * variants + products pour éviter les allers-retours au sync.
   */
  include?: string;
}

const DEFAULT_INCLUDE = "retailer,billingItems,orderItems.productVariant.product";

/** GET /orders — liste paginée par curseur. */
export async function ankorstoreListOrders(
  opts: AnkorstoreListOrdersOptions = {},
): Promise<AnkorstoreOrdersListResponse> {
  const params = new URLSearchParams();
  params.set("page[limit]", String(opts.limit ?? 50));
  if (opts.after) params.set("page[after]", opts.after);
  if (opts.status) params.set("filter[status]", opts.status);
  params.set("include", opts.include ?? DEFAULT_INCLUDE);
  return ankorstoreGetJson<AnkorstoreOrdersListResponse>(`/orders?${params.toString()}`);
}

/** GET /orders/{orderId} — détail complet avec includes. */
export async function ankorstoreGetOrderDetail(
  orderId: string,
  opts: { include?: string } = {},
): Promise<AnkorstoreOrderDetailResponse> {
  const params = new URLSearchParams();
  params.set("include", opts.include ?? DEFAULT_INCLUDE);
  return ankorstoreGetJson<AnkorstoreOrderDetailResponse>(
    `/orders/${encodeURIComponent(orderId)}?${params.toString()}`,
  );
}

// ─────────────────────────────────────────────
// Helpers de normalisation
// ─────────────────────────────────────────────

/** Convertit un montant Ankorstore (centimes) en euros Decimal-friendly. */
export function ankorstoreCentsToEuros(cents: number | null | undefined): number {
  if (cents == null || Number.isNaN(cents)) return 0;
  return Math.round(cents) / 100;
}

export type AnkorstoreOrderStatusNormalized = "NEW" | "VALIDATED" | "SHIPPED" | "CANCELLED";

/**
 * Statut brut Ankorstore → notre enum interne.
 *
 * NEW       : commande soumise, en attente de confirmation marque.
 * VALIDATED : confirmée côté Ankor (à préparer).
 * SHIPPED   : expédiée, livrée ou payée à la marque — post-expédition.
 * CANCELLED : annulée ou rejetée (par la marque, le retailer ou Ankor).
 */
export function normalizeAnkorstoreStatus(raw: string | null | undefined): AnkorstoreOrderStatusNormalized {
  const r = String(raw ?? "").toLowerCase();
  if (
    r === "cancelled" ||
    r === "canceled" ||
    r === "rejected" ||
    r === "brand_rejected" ||
    r === "retailer_rejected" ||
    r === "refunded"
  ) {
    return "CANCELLED";
  }
  if (
    r === "shipped" ||
    r === "delivered" ||
    r === "brand_paid" ||
    r === "fulfilled"
  ) {
    return "SHIPPED";
  }
  if (
    r === "ankor_confirmed" ||
    r === "brand_confirmed" ||
    r === "confirmed" ||
    r === "processing" ||
    r === "retailer_paid"
  ) {
    return "VALIDATED";
  }
  return "NEW";
}

/**
 * Extrait la référence produit BJ depuis un SKU Ankorstore.
 * Format typique : `<REF>_<couleur>_<hash>` (ex "PRT35_blanc_iz0dtf3t" → "PRT35").
 * Retourne null si le SKU est vide ou n'a pas de séparateur.
 */
export function extractReferenceFromSku(sku: string | null | undefined): string | null {
  if (!sku) return null;
  const trimmed = sku.trim();
  if (!trimmed) return null;
  const first = trimmed.split("_")[0];
  return first && first.length >= 2 ? first : null;
}

/**
 * Récupère la meilleure info de tracking dans un shippingOverview.
 * Prend parcels[0].trackedPackage en priorité, puis transaction.tracking en fallback.
 */
export function extractTrackingInfo(overview: AnkorstoreShippingOverview | null | undefined): {
  trackingNumber: string | null;
  trackingLink: string | null;
  status: string | null;
  statusDetails: string | null;
  updatedAt: Date | null;
} {
  if (!overview) {
    return { trackingNumber: null, trackingLink: null, status: null, statusDetails: null, updatedAt: null };
  }
  const parcel = overview.parcels?.[0]?.trackedPackage;
  const tx = overview.transaction?.tracking;
  const top = overview.tracking;

  const trackingNumber =
    parcel?.trackingNumber ?? tx?.trackingNumber ?? top?.number ?? null;
  const trackingLink =
    parcel?.trackingLink ?? tx?.trackingLink ?? top?.link ?? null;
  const status =
    parcel?.currentStatus?.status ?? tx?.currentStatus?.status ?? null;
  const statusDetails =
    parcel?.currentStatus?.statusDetails ?? tx?.currentStatus?.statusDetails ?? null;
  const updatedAtRaw =
    parcel?.currentStatus?.updatedAt ?? tx?.currentStatus?.updatedAt ?? null;
  const updatedAt = updatedAtRaw ? new Date(updatedAtRaw) : null;

  return { trackingNumber, trackingLink, status, statusDetails, updatedAt };
}
