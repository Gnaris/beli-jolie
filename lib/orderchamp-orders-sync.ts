/**
 * Orderchamp Orders Sync — synchronisation lecture seule des commandes OC.
 *
 * Deux modes (calqués sur `lib/faire-orders-sync.ts`) :
 *  - `syncRecentOrderchampOrders(tenantId)` : lit la 1ère page (50 dernières),
 *    upsert les commandes nouvelles ou dont `updatedAt` / statut ont changé.
 *  - `importAllOrderchampOrdersFor(tenantId, onProgress)` : rattrapage historique
 *    complet, déroule la pagination Relay jusqu'à `hasNextPage=false`.
 *
 * Matching produit (priorité descendante) :
 *   1. `ProductColor.orderchampVariantId == item.id` (le plus fiable)
 *   2. `Product.orderchampProductId == item.productId` (via SKU dérivé)
 *   3. Fallback : `Product.reference == referenceBase extraite du SKU`
 *
 * Upsert fiche client (AdminClientCard) :
 *   1. `tenantId + orderchampRetailerId` (lookup direct)
 *   2. Fallback company_name / retailer.name normalisé
 *   3. Création `importedFromMarketplace = "ORDERCHAMP"`, `hasOrderchamp = true`
 */

import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { logger } from "@/lib/logger";
import { resolveCountryCode } from "@/lib/countries";
import {
  computeOrderchampOrderTotal,
  extractReferenceFromOrderchampSku,
  normalizeOrderchampStatus,
  orderchampAmountToDecimalString,
  orderchampListOrders,
  type OrderchampOrderAddress,
  type OrderchampOrderResource,
} from "@/lib/orderchamp-orders-api";

const D = Prisma.Decimal;

// ─────────────────────────────────────────────
// Client card upsert
// ─────────────────────────────────────────────

function normalizeCompanyKey(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const cleaned = String(raw).trim().toLowerCase().replace(/\s+/g, " ");
  return cleaned.length > 0 ? cleaned : null;
}

function pickCustomerNameParts(address: OrderchampOrderAddress | null | undefined): {
  firstName: string;
  lastName: string;
} {
  const first = (address?.firstName ?? "").trim();
  const last = (address?.lastName ?? "").trim();
  if (first || last) return { firstName: first, lastName: last };
  const company = (address?.company ?? "").trim();
  return { firstName: "", lastName: company || "(client Orderchamp)" };
}

async function upsertOrderchampClientCard(
  tenantId: string,
  order: OrderchampOrderResource,
): Promise<string | null> {
  const retailerId = order.retailer?.id ?? null;
  if (!retailerId) return null;

  const { firstName, lastName } = pickCustomerNameParts(order.shippingAddress);
  const companyName = (order.shippingAddress?.company ?? order.retailer?.name ?? "").trim() || null;
  const email = order.retailer?.email?.trim().toLowerCase() || null;
  const phone = order.shippingAddress?.phone?.trim() || null;
  const country =
    resolveCountryCode(order.shippingAddress?.countryCode ?? null) ??
    order.shippingAddress?.countryCode ??
    null;
  const addressLine = [order.shippingAddress?.street].filter(Boolean).join(", ") || null;
  const postalCode = order.shippingAddress?.postalCode?.trim() || null;
  const city = order.shippingAddress?.city?.trim() || null;
  const createdAtOc = new Date(order.createdAt);

  const existingByRetailer = await prisma.adminClientCard.findFirst({
    where: { tenantId, orderchampRetailerId: retailerId },
    select: { id: true, lastOrderAt: true },
  });
  if (existingByRetailer) {
    await prisma.adminClientCard.update({
      where: { id: existingByRetailer.id },
      data: {
        hasOrderchamp: true,
        lastOrderAt:
          existingByRetailer.lastOrderAt && existingByRetailer.lastOrderAt >= createdAtOc
            ? existingByRetailer.lastOrderAt
            : createdAtOc,
      },
    });
    return existingByRetailer.id;
  }

  // Fallback : match par company nom (Orderchamp n'expose pas de SIRET dans /orders)
  const companyKey = normalizeCompanyKey(companyName);
  if (companyKey) {
    const existingByCompany = await prisma.adminClientCard.findFirst({
      where: { tenantId, company: { equals: companyName ?? undefined } },
      select: { id: true, lastOrderAt: true },
    });
    if (existingByCompany) {
      await prisma.adminClientCard.update({
        where: { id: existingByCompany.id },
        data: {
          hasOrderchamp: true,
          orderchampRetailerId: retailerId,
          lastOrderAt:
            existingByCompany.lastOrderAt && existingByCompany.lastOrderAt >= createdAtOc
              ? existingByCompany.lastOrderAt
              : createdAtOc,
        },
      });
      return existingByCompany.id;
    }
  }

  const created = await prisma.adminClientCard.create({
    data: {
      tenantId,
      firstName,
      lastName,
      company: companyName,
      email,
      phone,
      addressLine,
      postalCode,
      city,
      countryCode: country ?? null,
      importedFromMarketplace: "ORDERCHAMP",
      hasOrderchamp: true,
      orderchampRetailerId: retailerId,
      lastOrderAt: createdAtOc,
    },
    select: { id: true },
  });
  return created.id;
}

// ─────────────────────────────────────────────
// Upsert commande
// ─────────────────────────────────────────────

interface LinkedProductRow {
  id: string;
  name: string;
  reference: string;
  colors: { id: string; orderchampVariantId: string | null }[];
}

async function findLinkedProduct(
  tenantId: string,
  item: OrderchampOrderResource["products"]["edges"][number]["node"],
): Promise<{ product: LinkedProductRow | null; refBase: string | null }> {
  const refBase = extractReferenceFromOrderchampSku(item.sku);

  // 1) Match direct via `orderchampVariantId`
  if (item.id) {
    const byVariant = await prisma.product.findFirst({
      where: { tenantId, colors: { some: { orderchampVariantId: item.id } } },
      select: {
        id: true,
        name: true,
        reference: true,
        colors: { select: { id: true, orderchampVariantId: true } },
      },
    });
    if (byVariant) return { product: byVariant, refBase };
  }

  // 2) Fallback : reference (segment SKU)
  if (refBase) {
    const byRef = await prisma.product.findFirst({
      where: { tenantId, reference: refBase },
      select: {
        id: true,
        name: true,
        reference: true,
        colors: { select: { id: true, orderchampVariantId: true } },
      },
    });
    if (byRef) return { product: byRef, refBase };
  }

  return { product: null, refBase };
}

async function upsertOrderchampOrderFromResource(
  tenantId: string,
  order: OrderchampOrderResource,
): Promise<{ orderId: string; created: boolean }> {
  const statusEnum = normalizeOrderchampStatus(order.status);
  const totalHT = new D(orderchampAmountToDecimalString(computeOrderchampOrderTotal(order)));
  const createdAtOc = new Date(order.createdAt);
  const updatedAtOc = order.updatedAt ? new Date(order.updatedAt) : null;
  const shippedAt = statusEnum === "SHIPPED" ? updatedAtOc ?? createdAtOc : null;
  const canceledAt = statusEnum === "CANCELLED" ? updatedAtOc ?? createdAtOc : null;

  const adminClientCardId = await upsertOrderchampClientCard(tenantId, order).catch((err) => {
    logger.warn("[Orderchamp Orders Sync] upsert client échec", {
      tenantId,
      orderchampOrderId: order.id,
      error: err,
    });
    return null;
  });

  const shippingCountryCode =
    resolveCountryCode(order.shippingAddress?.countryCode ?? null) ??
    order.shippingAddress?.countryCode ??
    null;

  const existing = await prisma.orderchampOrder.findFirst({
    where: { tenantId, orderchampOrderId: order.id },
    select: { id: true, items: { select: { orderchampItemId: true, stockDeductedAt: true } } },
  });

  const orderData = {
    tenantId,
    orderchampOrderId: order.id,
    displayId: order.reference ?? String(order.databaseId ?? ""),
    status: statusEnum,
    statusRaw: order.status,
    currency: order.currency ?? "EUR",
    createdAtOrderchamp: createdAtOc,
    updatedAtOrderchamp: updatedAtOc,
    shippedAt,
    canceledAt,
    totalHT,
    // Commission / payoutFee / netAmount ne sont pas exposés par le fragment
    // actuel — restent à 0. À enrichir quand OC exposera ces champs.
    commissionAmount: new D("0.00"),
    payoutFeeAmount: new D("0.00"),
    netAmount: totalHT,
    shippingName:
      [order.shippingAddress?.firstName, order.shippingAddress?.lastName]
        .filter(Boolean)
        .join(" ") || null,
    shippingCompany: order.shippingAddress?.company ?? null,
    shippingStreet: order.shippingAddress?.street ?? null,
    shippingStreet2: null,
    shippingCity: order.shippingAddress?.city ?? null,
    shippingStateCode: null,
    shippingPostalCode: order.shippingAddress?.postalCode ?? null,
    shippingCountryCode,
    shippingPhone: order.shippingAddress?.phone ?? null,
    orderchampRetailerId: order.retailer?.id ?? "unknown",
    customerName: order.retailer?.name ?? "(inconnu)",
    customerShop: order.shippingAddress?.company ?? null,
    customerEmail: order.retailer?.email ?? null,
    customerPhone: order.shippingAddress?.phone ?? null,
    customerCountry: shippingCountryCode,
    adminClientCardId,
    rawDetailJson: order as unknown as Prisma.InputJsonValue,
    lastSyncedAt: new Date(),
  };

  let orderRowId: string;
  let created = false;
  if (existing) {
    orderRowId = existing.id;
    await prisma.orderchampOrder.update({ where: { id: existing.id }, data: orderData });
    // Reset items — on garde le `stockDeductedAt` par ligne pour idempotence.
    const previouslyDeducted = new Map(
      existing.items.map((it) => [it.orderchampItemId, it.stockDeductedAt]),
    );
    await prisma.orderchampOrderItem.deleteMany({ where: { orderchampOrderId: existing.id } });

    const itemsToCreate = await Promise.all(
      order.products.edges.map(async (edge) => {
        const item = edge.node;
        const { product, refBase } = await findLinkedProduct(tenantId, item);
        const productColor = product?.colors.find((c) => c.orderchampVariantId === item.id) ?? null;
        const unitPrice = new D(orderchampAmountToDecimalString(item.price ?? 0));
        const totalPrice = unitPrice.mul(item.quantity ?? 0);
        return {
          tenantId,
          orderchampOrderId: orderRowId,
          orderchampItemId: item.id,
          orderchampProductId: null,
          orderchampVariantId: item.id,
          sku: item.sku ?? null,
          referenceBase: refBase,
          productId: product?.id ?? null,
          productColorId: productColor?.id ?? null,
          productSnapshotName: item.title ?? product?.name ?? null,
          variantOptionLabel: null,
          quantity: item.quantity ?? 0,
          unitPriceHT: unitPrice,
          totalPriceHT: totalPrice,
          stockDeductedAt: previouslyDeducted.get(item.id) ?? null,
        };
      }),
    );
    await prisma.orderchampOrderItem.createMany({ data: itemsToCreate });
  } else {
    created = true;
    const row = await prisma.orderchampOrder.create({ data: orderData, select: { id: true } });
    orderRowId = row.id;
    const itemsToCreate = await Promise.all(
      order.products.edges.map(async (edge) => {
        const item = edge.node;
        const { product, refBase } = await findLinkedProduct(tenantId, item);
        const productColor = product?.colors.find((c) => c.orderchampVariantId === item.id) ?? null;
        const unitPrice = new D(orderchampAmountToDecimalString(item.price ?? 0));
        const totalPrice = unitPrice.mul(item.quantity ?? 0);
        return {
          tenantId,
          orderchampOrderId: orderRowId,
          orderchampItemId: item.id,
          orderchampProductId: null,
          orderchampVariantId: item.id,
          sku: item.sku ?? null,
          referenceBase: refBase,
          productId: product?.id ?? null,
          productColorId: productColor?.id ?? null,
          productSnapshotName: item.title ?? product?.name ?? null,
          variantOptionLabel: null,
          quantity: item.quantity ?? 0,
          unitPriceHT: unitPrice,
          totalPriceHT: totalPrice,
          stockDeductedAt: null,
        };
      }),
    );
    await prisma.orderchampOrderItem.createMany({ data: itemsToCreate });
  }

  return { orderId: orderRowId, created };
}

// ─────────────────────────────────────────────
// Sync incrémentale
// ─────────────────────────────────────────────

const SYNC_BUFFER_MS = 15 * 60_000;
const SYNC_FALLBACK_MS = 24 * 60 * 60_000;
const SYNC_MAX_PAGES = 20;

async function readLastSyncedAt(tenantId: string): Promise<number | null> {
  const row = await prisma.siteConfig.findFirst({
    where: { tenantId, key: "orderchamp_orders_last_synced_at" },
    select: { value: true },
  });
  if (!row?.value) return null;
  const parsed = parseInt(row.value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

/**
 * Polling incrémental Orderchamp.
 *
 * Orderchamp expose des commandes triées par `createdAt` DESC. On déroule la
 * pagination Relay jusqu'à croiser une commande antérieure au `cutoff`
 * (lastSyncedAt - buffer) — les commandes plus anciennes n'ont plus besoin
 * d'être re-scannées si leur `updatedAt` n'a pas changé. On force quand même
 * la relecture des 50 dernières pour capter les changements de statut
 * (NEW → SHIPPED).
 */
export async function syncRecentOrderchampOrders(tenantId: string): Promise<{
  created: number;
  updated: number;
  scanned: number;
}> {
  const lastSyncedAt = await readLastSyncedAt(tenantId);
  const cutoffMs = (lastSyncedAt ?? Date.now() - SYNC_FALLBACK_MS) - SYNC_BUFFER_MS;

  let created = 0;
  let updated = 0;
  let scanned = 0;
  let cursor: string | null = null;

  for (let page = 0; page < SYNC_MAX_PAGES; page++) {
    const resp = await orderchampListOrders({ first: 50, after: cursor });
    const orders = resp.orders;
    if (orders.length === 0) break;
    scanned += orders.length;

    const ids = orders.map((o) => o.id);
    const existingRows = await prisma.orderchampOrder.findMany({
      where: { tenantId, orderchampOrderId: { in: ids } },
      select: { orderchampOrderId: true, updatedAtOrderchamp: true, statusRaw: true },
    });
    const existingMap = new Map(
      existingRows.map((r) => [
        r.orderchampOrderId,
        { updatedAtOrderchamp: r.updatedAtOrderchamp, statusRaw: r.statusRaw },
      ]),
    );

    let allOlderThanCutoff = orders.length > 0;

    for (const order of orders) {
      const existing = existingMap.get(order.id);
      const apiUpdated = order.updatedAt
        ? new Date(order.updatedAt).getTime()
        : new Date(order.createdAt).getTime();
      if (apiUpdated >= cutoffMs) allOlderThanCutoff = false;
      const bddUpdated = existing?.updatedAtOrderchamp?.getTime() ?? 0;
      const statusChanged = existing && existing.statusRaw !== order.status;
      if (!existing || apiUpdated > bddUpdated || statusChanged) {
        try {
          const res = await upsertOrderchampOrderFromResource(tenantId, order);
          if (res.created) created++;
          else updated++;
        } catch (err) {
          logger.warn("[Orderchamp Orders Sync] Échec import commande", {
            tenantId,
            orderchampOrderId: order.id,
            error: err,
          });
        }
      }
    }

    if (!resp.hasNextPage || allOlderThanCutoff) break;
    cursor = resp.endCursor;
    if (!cursor) break;
  }

  return { created, updated, scanned };
}

// ─────────────────────────────────────────────
// Import historique complet
// ─────────────────────────────────────────────

export interface OrderchampImportProgress {
  totalOrders: number | null;
  processed: number;
  created: number;
  updated: number;
  currentOrder?: {
    orderchampOrderId: string;
    displayId: string;
    customerName: string;
    totalHT: number | null;
    country: string | null;
  } | null;
}

export async function importAllOrderchampOrdersFor(
  tenantId: string,
  onProgress?: (p: OrderchampImportProgress) => void,
  shouldStop?: () => Promise<boolean>,
): Promise<{ created: number; updated: number; scanned: number }> {
  let created = 0;
  let updated = 0;
  let scanned = 0;
  let cursor: string | null = null;

  while (true) {
    if (shouldStop && (await shouldStop())) break;
    const resp = await orderchampListOrders({ first: 100, after: cursor });
    if (resp.orders.length === 0) break;
    for (const order of resp.orders) {
      if (shouldStop && (await shouldStop())) break;
      scanned++;
      try {
        const res = await upsertOrderchampOrderFromResource(tenantId, order);
        if (res.created) created++;
        else updated++;
        onProgress?.({
          totalOrders: null,
          processed: scanned,
          created,
          updated,
          currentOrder: {
            orderchampOrderId: order.id,
            displayId: order.reference ?? String(order.databaseId ?? ""),
            customerName: order.retailer?.name ?? "(inconnu)",
            totalHT: computeOrderchampOrderTotal(order),
            country: order.shippingAddress?.countryCode ?? null,
          },
        });
      } catch (err) {
        logger.warn("[Orderchamp Orders] Import historique échec commande", {
          tenantId,
          orderchampOrderId: order.id,
          error: err,
        });
      }
    }
    if (!resp.hasNextPage) break;
    cursor = resp.endCursor;
    if (!cursor) break;
  }

  return { created, updated, scanned };
}
