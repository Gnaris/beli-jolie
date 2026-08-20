/**
 * Orderchamp — API commandes (lecture seule pour le worker sync).
 *
 * Wrappers GraphQL typés autour des queries `Order($id)` et `Orders($first, $after)`
 * déjà déclarées dans `lib/orderchamp-queries.ts`. Pagination Relay standard
 * (`endCursor` / `hasNextPage`).
 *
 * ⚠️ LECTURE SEULE. Les mutations `orderConfirm` / `orderCancel` restent
 * exposées via `lib/orderchamp-queries.ts` mais ne sont pas invoquées ici.
 *
 * Contrairement à Faire (REST paginé par page/limit), Orderchamp expose une
 * API GraphQL avec cursor : on ne peut pas filtrer par `updated_at_min`
 * côté serveur — on filtre côté client à partir du snapshot `lastSyncedAt`.
 */

import { orderchampGraphQL } from "@/lib/orderchamp-client";
import { ORDER_QUERY, ORDERS_LIST_QUERY } from "@/lib/orderchamp-queries";
import { logger } from "@/lib/logger";

// ─────────────────────────────────────────────
// Types — commandes Orderchamp (miroir GraphQL)
// ─────────────────────────────────────────────

export interface OrderchampOrderAddress {
  firstName?: string | null;
  lastName?: string | null;
  company?: string | null;
  street?: string | null;
  city?: string | null;
  postalCode?: string | null;
  countryCode?: string | null;
  phone?: string | null;
}

export interface OrderchampRetailer {
  id: string;
  name?: string | null;
  email?: string | null;
}

export interface OrderchampOrderItemResource {
  id: string;
  sku?: string | null;
  title?: string | null;
  quantity: number;
  price?: number | null;
}

export type OrderchampOrderStatusRaw =
  | "NEW"
  | "CONFIRMED"
  | "SHIPPED"
  | "DELIVERED"
  | "CANCELLED"
  | string;

export interface OrderchampOrderResource {
  id: string;
  databaseId?: string | number | null;
  reference?: string | null;
  status: OrderchampOrderStatusRaw;
  createdAt: string;
  updatedAt?: string | null;
  total?: number | null;
  subtotal?: number | null;
  currency?: string | null;
  retailer?: OrderchampRetailer | null;
  shippingAddress?: OrderchampOrderAddress | null;
  products: { edges: { node: OrderchampOrderItemResource }[] };
}

interface OrderQueryResponse {
  order: OrderchampOrderResource | null;
}

interface OrdersListResponse {
  orders: {
    edges: { cursor: string; node: OrderchampOrderResource }[];
    pageInfo: { hasNextPage: boolean; endCursor: string | null };
  };
}

// ─────────────────────────────────────────────
// Wrappers GraphQL
// ─────────────────────────────────────────────

export async function orderchampGetOrder(
  id: string,
): Promise<OrderchampOrderResource | null> {
  try {
    const data = await orderchampGraphQL<OrderQueryResponse>(ORDER_QUERY, { id }, "order");
    return data.order ?? null;
  } catch (err) {
    logger.warn("[Orderchamp Orders] orderchampGetOrder échec", { id, error: err });
    return null;
  }
}

/**
 * Liste paginée. `after` = curseur de la page précédente (null = 1ère page).
 * Renvoie aussi `hasNextPage` + `endCursor` pour dérouler la pagination.
 */
export async function orderchampListOrders(params: {
  first?: number;
  after?: string | null;
}): Promise<{
  orders: OrderchampOrderResource[];
  hasNextPage: boolean;
  endCursor: string | null;
}> {
  const first = Math.max(1, Math.min(params.first ?? 50, 100));
  const data = await orderchampGraphQL<OrdersListResponse>(ORDERS_LIST_QUERY, {
    first,
    after: params.after ?? null,
  }, "orders");
  return {
    orders: data.orders.edges.map((e) => e.node),
    hasNextPage: data.orders.pageInfo.hasNextPage,
    endCursor: data.orders.pageInfo.endCursor,
  };
}

// ─────────────────────────────────────────────
// Helpers de normalisation
// ─────────────────────────────────────────────

/**
 * Convertit le statut brut Orderchamp vers l'enum `OrderchampOrderStatus`
 * Prisma (NEW / SHIPPED / CANCELLED). CONFIRMED reste NEW côté BJ : on ne
 * bascule en SHIPPED que quand l'ordre est réellement expédié.
 */
export function normalizeOrderchampStatus(raw: string): "NEW" | "SHIPPED" | "CANCELLED" {
  const s = raw.toUpperCase();
  if (s === "SHIPPED" || s === "DELIVERED" || s === "COMPLETE") return "SHIPPED";
  if (s === "CANCELLED" || s === "CANCELED" || s === "REJECTED") return "CANCELLED";
  return "NEW";
}

/**
 * Convertit un montant Orderchamp (nombre décimal en euros) vers un
 * `Decimal(12,2)` compatible Prisma. `null` / `undefined` → 0.
 */
export function orderchampAmountToDecimalString(amount: number | null | undefined): string {
  if (amount == null || !Number.isFinite(amount)) return "0.00";
  return amount.toFixed(2);
}

/**
 * Total commande = somme des lignes si `total` n'est pas exposé (Orderchamp
 * peut renvoyer 0 sur certains marchés).
 */
export function computeOrderchampOrderTotal(order: OrderchampOrderResource): number {
  if (typeof order.total === "number" && order.total > 0) return order.total;
  return order.products.edges.reduce((acc, e) => {
    const p = e.node.price ?? 0;
    const q = e.node.quantity ?? 0;
    return acc + p * q;
  }, 0);
}

/**
 * Extrait la partie référence produit à partir du SKU Orderchamp. Le format
 * BJ est `{REFERENCE}_{COLOR}[_{SIZE}]_{UNIT|PACK}_{suffix}` — on récupère le
 * premier segment (voir `lib/orderchamp-sku.ts`).
 */
export function extractReferenceFromOrderchampSku(sku: string | null | undefined): string | null {
  if (!sku) return null;
  const first = sku.trim().split(/[_\-]/)[0];
  return first || null;
}
