/**
 * Lecture des commandes Ankorstore (back-office reverse-engineered).
 *
 * Endpoints reversés depuis le HAR "Commande Ankorstore.har" (2026-08-13) :
 *   - GET /api/internal/v1/ordering/orders            → liste paginée
 *   - GET /api/internal/v1/ordering/orders/{uuid}     → détail
 *   - GET /api/internal/v1/ordering/orders/{uuid}/order-items?include=orderedProduct
 *   - GET /api/v1/master-orders/{uuid}/tracking?include=shipmentParcel
 *   - GET /api/orders/{internalId}/tracking/carriers  → référentiel transporteurs
 *
 * Format JSON:API 1.0 (data + included + meta + links).
 *
 * NON couvert (HARs à capturer) : marquer expédiée, ajouter tracking manuel,
 * rejeter une commande, annuler étiquette, split, réponse à un litige.
 */

import { boGet } from "./client";

// ─── Types ────────────────────────────────────────────────────────────────

export interface BoOrderSummary {
  /** UUID version 6 — utilisé pour tous les endpoints détail. */
  uuid: string;
  /** ID numérique interne (ex 5070036) — utilisé pour /api/orders/{internalId}/tracking/carriers. */
  internalId: number;
  createdAt: string;
  type: "internal" | string;
  /** Référence humaine (ex "IJDD3922982") — présente sur le détail. */
  reference?: string | null;
  status: {
    name: BoOrderStatus;
    shortTitle: string;
    title: string;
    details: string;
    subStatus: string | null;
  };
  totals: {
    /** HT en centimes. */
    totalAmount: BoMoney;
    /** TVA en centimes. */
    totalVatAmount: BoMoney;
    /** TTC en centimes. */
    totalAmountWithVat: BoMoney;
    /** Ce que la marque touche (après frais Ankor), centimes. */
    netAmount: BoMoney;
  };
  deadlines: {
    toAccept: string | null;
    toShip: string | null;
    updatedToShip: string | null;
    toActOnIssue: string | null;
  };
  retailer: BoRetailer;
  tracking: {
    trackingNumber: string | null;
    trackingLink: string | null;
    status: BoTrackingStatus | null;
  } | null;
  fulfillmentReference: string | null;
}

export interface BoOrderDetail extends BoOrderSummary {
  reference: string;
  masterStatus: string;
  customReference: string | null;
  brand: { id?: number; name?: string };
  invoices: Array<{
    type: string;
    label: string;
    path: string;
    generatedAt: string | null;
  }>;
  shipping: {
    shippingProvider: string | null;
    shippingMethod: string | null;
    shippingAddress: BoAddress | null;
    shipment: BoShipment | null;
    hasRevertedShippingLabels: boolean;
    isAnkorlogisticsAvailable: boolean;
  };
  billing: {
    billingItems: Array<{
      type: string;
      label: string;
      amount: BoMoney;
    }>;
  };
  events: Array<{
    type: string;
    createdAt: string;
    [key: string]: unknown;
  }>;
  updates: unknown | null;
  vat: { isShifted: boolean };
}

export type BoOrderStatus =
  | "pending"
  | "shipped"
  | "invoiced"
  | "brand_paid"
  | "cancelled"
  | "rejected"
  | string;

export type BoTrackingStatus = "TRANSIT" | "DELIVERED" | "LABEL_CREATED" | "EXCEPTION" | string;

export interface BoMoney {
  amount: number;
  currency: string;
}

export interface BoRetailer {
  id: number;
  uuid: string;
  name: string;
  store_url: string | null;
  phone_number: string | null;
  email: string | null;
  city: string | null;
  business: {
    user_first_name: string | null;
    user_last_name: string | null;
    vat_number: string | null;
    tax_number: string | null;
    country?: { iso_code: string };
  };
}

export interface BoAddress {
  address: {
    countryCode: string;
    postalCode: string;
    city: string;
    addressLine: string;
  };
  company: string;
  contactPerson: {
    firstName: string | null;
    lastName: string | null;
    fullName: string | null;
    phoneNumber: string | null;
    email: string | null;
  };
}

export interface BoShipment {
  shippedAt: string | null;
  trackedPackagesMergedLabelUrl: string | null;
  labelRevertReasons: string[];
}

export interface BoOrderItem {
  uuid: string;
  internalId: number;
  batchQuantity: number;
  unitQuantity: number;
  unitPrice: BoMoney;
  totalPrice: BoMoney;
  product: {
    uuid: string;
    sku: string;
    name: string;
    pageUrl: string;
    hsCode: string | null;
    madeInCountry: string | null;
    images: string[];
    options: Array<{ name: string; value: string }>;
  };
}

export interface BoTracking {
  uuid: string;
  carrier: string | null;
  trackingNumber: string | null;
  trackingLink: string | null;
  status: BoTrackingStatus | null;
  parcels: Array<{
    height: number;
    width: number;
    length: number;
    weight: number;
    trackingNumber: string | null;
    trackingLink: string | null;
    status: BoTrackingStatus | null;
    label: string | null;
  }>;
}

export interface BoOrdersListMeta {
  countByStatus: Record<string, number>;
  countByType: Record<string, number>;
  page: {
    current: number;
    from: number;
    lastPage: number;
    perPage: number;
    to: number;
    total: number;
  };
}

export interface BoOrdersListResult {
  orders: BoOrderSummary[];
  meta: BoOrdersListMeta;
  links: { first?: string; last?: string; next?: string; prev?: string };
}

// ─── Fields sets par défaut (limitent le payload) ─────────────────────────

const LIST_FIELDS =
  "priorityTag,createdAt,deadlines,internalId,internalUuid,issue,rejection,retailer,status,synchronizations,totals,tracking,type,orderShipping,fulfillmentReference,orderIssue,metadata,amounts,externalOrderType";

// ─── Endpoints ────────────────────────────────────────────────────────────

/**
 * Liste paginée des commandes.
 * @param opts.offset offset (page = offset / limit)
 * @param opts.limit  taille de page (défaut 15, max non testé — Ankor accepte au moins 50)
 */
export async function listOrders(
  opts: { offset?: number; limit?: number } = {}
): Promise<BoOrdersListResult> {
  const offset = opts.offset ?? 0;
  const limit = opts.limit ?? 15;
  const qs = new URLSearchParams({
    include: "orderShipping,orderIssue",
    "fields[order-shipping]": "shippingMethod,isAddingTrackingInformationPostponed,stockOrigin",
    "fields[order-issue]": "trackingLink,willAddTrackingLater,status",
    "fields[orders]": LIST_FIELDS,
    "page[offset]": String(offset),
    "page[limit]": String(limit),
  });
  const raw = await boGet<JsonApiListResponse>(
    `/api/internal/v1/ordering/orders?${qs.toString()}`
  );
  return {
    orders: raw.data.map(mapOrderSummary),
    meta: mapMeta(raw.meta),
    links: raw.links ?? {},
  };
}

/** Renvoie 1 commande détaillée. */
export async function getOrderDetail(uuid: string): Promise<BoOrderDetail | null> {
  const qs = new URLSearchParams({
    include: "orderShipping,orderIssue,brandRetailerRelationship,splitOff,splitFrom",
    "fields[orderShipping]":
      "shippingMethod,isAddingTrackingInformationPostponed,stockOrigin",
    "fields[split-orders]": "uuid,wrapperOrderInternalId",
  });
  try {
    const raw = await boGet<JsonApiSingleResponse>(
      `/api/internal/v1/ordering/orders/${uuid}?${qs.toString()}`
    );
    return mapOrderDetail(raw.data);
  } catch (err) {
    const anyErr = err as { status?: number };
    if (anyErr.status === 404) return null;
    throw err;
  }
}

/** Retourne les lignes d'une commande (produits commandés). */
export async function getOrderItems(uuid: string): Promise<BoOrderItem[]> {
  const raw = await boGet<JsonApiListWithIncludedResponse>(
    `/api/internal/v1/ordering/orders/${uuid}/order-items?include=orderedProduct`
  );
  const products = new Map<string, JsonApiResource>();
  for (const inc of raw.included ?? []) {
    if (inc.type === "ordered-products") products.set(inc.id, inc);
  }
  return raw.data.map((item) => {
    const rel = item.relationships?.orderedProduct?.data;
    const productId = Array.isArray(rel) ? rel[0]?.id : rel?.id;
    const product = productId ? products.get(productId) : undefined;
    const a = (item.attributes ?? {}) as Record<string, unknown>;
    const p = (product?.attributes ?? {}) as Record<string, unknown>;
    return {
      uuid: item.id,
      internalId: Number(a.internalId ?? 0),
      batchQuantity: Number(a.batchQuantity ?? 0),
      unitQuantity: Number(a.unitQuantity ?? 0),
      unitPrice: a.unitPrice as BoMoney,
      totalPrice: a.totalPrice as BoMoney,
      product: {
        uuid: product?.id ?? "",
        sku: (p.sku ?? "") as string,
        name: (p.name ?? "") as string,
        pageUrl: (p.pageUrl ?? "") as string,
        hsCode: (p.hsCode ?? null) as string | null,
        madeInCountry: (p.madeInCountry ?? null) as string | null,
        images: (p.images ?? []) as string[],
        options: (p.options ?? []) as Array<{ name: string; value: string }>,
      },
    };
  });
}

/** Retourne le tracking d'une commande. */
export async function getOrderTracking(uuid: string): Promise<BoTracking | null> {
  try {
    const raw = await boGet<JsonApiSingleWithIncludedResponse>(
      `/api/v1/master-orders/${uuid}/tracking?include=shipmentParcel`
    );
    const t = raw.data;
    const a = (t.attributes ?? {}) as Record<string, unknown>;
    const parcels = (raw.included ?? [])
      .filter((i) => i.type === "shipping-shipment-parcel")
      .map((i) => {
        const pa = (i.attributes ?? {}) as Record<string, unknown>;
        return {
          height: Number(pa.height ?? 0),
          width: Number(pa.width ?? 0),
          length: Number(pa.length ?? 0),
          weight: Number(pa.weight ?? 0),
          trackingNumber: (pa.trackingNumber ?? null) as string | null,
          trackingLink: (pa.trackingLink ?? null) as string | null,
          status: (pa.status ?? null) as BoTrackingStatus | null,
          label: (pa.label ?? null) as string | null,
        };
      });
    return {
      uuid: t.id,
      carrier: (a.carrier ?? null) as string | null,
      trackingNumber: (a.trackingNumber ?? null) as string | null,
      trackingLink: (a.trackingLink ?? null) as string | null,
      status: (a.status ?? null) as BoTrackingStatus | null,
      parcels,
    };
  } catch (err) {
    const anyErr = err as { status?: number };
    if (anyErr.status === 404) return null;
    throw err;
  }
}

/**
 * Retourne la table des transporteurs autorisés (code → libellé).
 * Attention : utilise l'`internalId` numérique de la commande, pas l'UUID.
 */
export async function getAvailableCarriers(
  internalId: number
): Promise<Record<string, string>> {
  return boGet<Record<string, string>>(
    `/api/orders/${internalId}/tracking/carriers`
  );
}

// ─── Helpers de mapping JSON:API → domaine ────────────────────────────────

interface JsonApiResource {
  type: string;
  id: string;
  attributes?: Record<string, unknown>;
  relationships?: Record<string, { data?: { type: string; id: string } | Array<{ type: string; id: string }> | null }>;
}
interface JsonApiListResponse {
  data: JsonApiResource[];
  meta?: Record<string, unknown>;
  links?: Record<string, string>;
}
interface JsonApiSingleResponse {
  data: JsonApiResource;
  meta?: Record<string, unknown>;
}
interface JsonApiListWithIncludedResponse extends JsonApiListResponse {
  included?: JsonApiResource[];
}
interface JsonApiSingleWithIncludedResponse extends JsonApiSingleResponse {
  included?: JsonApiResource[];
}

function mapOrderSummary(r: JsonApiResource): BoOrderSummary {
  const a = (r.attributes ?? {}) as Record<string, unknown>;
  return {
    uuid: r.id,
    internalId: Number(a.internalId ?? 0),
    createdAt: (a.createdAt ?? "") as string,
    type: (a.type ?? "internal") as string,
    reference: (a.reference ?? null) as string | null,
    status: a.status as BoOrderSummary["status"],
    totals: a.totals as BoOrderSummary["totals"],
    deadlines: a.deadlines as BoOrderSummary["deadlines"],
    retailer: a.retailer as BoRetailer,
    tracking: (a.tracking ?? null) as BoOrderSummary["tracking"],
    fulfillmentReference: (a.fulfillmentReference ?? null) as string | null,
  };
}

function mapOrderDetail(r: JsonApiResource): BoOrderDetail {
  const base = mapOrderSummary(r);
  const a = (r.attributes ?? {}) as Record<string, unknown>;
  return {
    ...base,
    reference: (a.reference ?? "") as string,
    masterStatus: (a.masterStatus ?? "") as string,
    customReference: (a.customReference ?? null) as string | null,
    brand: (a.brand ?? {}) as BoOrderDetail["brand"],
    invoices: (a.invoices ?? []) as BoOrderDetail["invoices"],
    shipping: (a.shipping ?? {}) as BoOrderDetail["shipping"],
    billing: (a.billing ?? { billingItems: [] }) as BoOrderDetail["billing"],
    events: (a.events ?? []) as BoOrderDetail["events"],
    updates: a.updates ?? null,
    vat: (a.vat ?? { isShifted: false }) as BoOrderDetail["vat"],
  };
}

function mapMeta(m?: Record<string, unknown>): BoOrdersListMeta {
  const countByStatus = (m?.count_by_status_key ?? {}) as Record<string, number>;
  const countByType = (m?.count_by_type_of_order ?? {}) as Record<string, number>;
  const page = (m?.page ?? {}) as Record<string, number>;
  return {
    countByStatus,
    countByType,
    page: {
      current: Number(page.currentPage ?? 1),
      from: Number(page.from ?? 0),
      lastPage: Number(page.lastPage ?? 1),
      perPage: Number(page.perPage ?? 15),
      to: Number(page.to ?? 0),
      total: Number(page.total ?? 0),
    },
  };
}
