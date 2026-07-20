"use server";

import { getServerSession } from "next-auth";
import { revalidatePath, revalidateTag } from "next/cache";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { requireCurrentTenant } from "@/lib/tenant";
import { logger } from "@/lib/logger";
import {
  getPfsImportState,
  startPfsHistoricalImportInBackground,
  requestStopPfsHistoricalImport,
  resetPfsImportState,
} from "@/lib/pfs-orders-import-state";
export type { PfsImportState } from "@/lib/pfs-orders-import-state";
import type { PfsImportState } from "@/lib/pfs-orders-import-state";
import { syncRecentPfsOrders, syncSinglePfsOrder } from "@/lib/pfs-orders-sync";

async function requireAdmin() {
  const session = await getServerSession(authOptions);
  if (!session || session.user.role !== "ADMIN") {
    throw new Error("Accès non autorisé.");
  }
  return session;
}

export type PfsPeriodKey =
  | "today"
  | "3d"
  | "week"
  | "15d"
  | "month"
  | "3m"
  | "6m"
  | "year"
  | "all";

interface PeriodRange {
  from: Date | null;
  to: Date | null;
}

function resolvePeriod(period: PfsPeriodKey): PeriodRange {
  const now = new Date();
  const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  switch (period) {
    case "today":
      return { from: startOfDay, to: null };
    case "3d":
      return { from: subDays(startOfDay, 3), to: null };
    case "week":
      return { from: subDays(startOfDay, 7), to: null };
    case "15d":
      return { from: subDays(startOfDay, 15), to: null };
    case "month":
      return { from: new Date(now.getFullYear(), now.getMonth(), 1), to: null };
    case "3m":
      return { from: subDays(startOfDay, 90), to: null };
    case "6m":
      return { from: subDays(startOfDay, 180), to: null };
    case "year":
      return { from: new Date(now.getFullYear(), 0, 1), to: null };
    case "all":
    default:
      return { from: null, to: null };
  }
}

function subDays(d: Date, days: number): Date {
  const copy = new Date(d.getTime());
  copy.setDate(copy.getDate() - days);
  return copy;
}

function decimalToNumber(v: unknown): number {
  if (v == null) return 0;
  if (typeof v === "number") return v;
  if (typeof v === "string") return Number(v);
  const asString = (v as { toString: () => string }).toString();
  return Number(asString);
}

// ─────────────────────────────────────────────
// Liste paginée + filtres
// ─────────────────────────────────────────────

export interface ListPfsOrdersInput {
  page?: number;
  perPage?: number;
  q?: string; // orderNumber, customerName, customerShop
  status?: "NEW" | "VALIDATED" | "SENT" | "CANCELLED" | null;
  carrier?: string | null;
  period?: PfsPeriodKey;
}

export interface PfsOrderListItem {
  id: string;
  pfsOrderId: string;
  orderNumber: string;
  createdAtPfs: string; // ISO
  status: "NEW" | "VALIDATED" | "SENT" | "CANCELLED";
  customerName: string;
  customerShop: string | null;
  customerCountry: string | null;
  carrier: string | null;
  totalTTC: number;
  totalHT: number;
  hasInvoice: boolean;
  hasCredit: boolean;
}

export interface ListPfsOrdersResult {
  items: PfsOrderListItem[];
  total: number;
  page: number;
  perPage: number;
  totalPages: number;
}

export async function listPfsOrders(input: ListPfsOrdersInput): Promise<ListPfsOrdersResult> {
  await requireAdmin();
  const tenant = await requireCurrentTenant();
  const page = Math.max(1, input.page ?? 1);
  const perPage = Math.min(200, Math.max(1, input.perPage ?? 30));
  const range = resolvePeriod(input.period ?? "all");

  const where: Record<string, unknown> = {
    tenantId: tenant.id,
    ...(input.status ? { status: input.status } : {}),
    ...(input.carrier ? { carrier: input.carrier } : {}),
    ...(range.from ? { createdAtPfs: { gte: range.from } } : {}),
    ...(input.q
      ? {
          OR: [
            { orderNumber: { contains: input.q } },
            { customerName: { contains: input.q } },
            { customerShop: { contains: input.q } },
            { customerCountry: { contains: input.q } },
          ],
        }
      : {}),
  };

  const [rows, total] = await Promise.all([
    prisma.pfsOrder.findMany({
      where,
      orderBy: { createdAtPfs: "desc" },
      skip: (page - 1) * perPage,
      take: perPage,
      select: {
        id: true,
        pfsOrderId: true,
        orderNumber: true,
        createdAtPfs: true,
        status: true,
        customerName: true,
        customerShop: true,
        customerCountry: true,
        carrier: true,
        totalTTC: true,
        totalHT: true,
        hasInvoice: true,
        hasCredit: true,
      },
    }),
    prisma.pfsOrder.count({ where }),
  ]);

  const items: PfsOrderListItem[] = rows.map((r) => ({
    id: r.id,
    pfsOrderId: r.pfsOrderId,
    orderNumber: r.orderNumber,
    createdAtPfs: r.createdAtPfs.toISOString(),
    status: r.status,
    customerName: r.customerName,
    customerShop: r.customerShop,
    customerCountry: r.customerCountry,
    carrier: r.carrier,
    totalTTC: decimalToNumber(r.totalTTC),
    totalHT: decimalToNumber(r.totalHT),
    hasInvoice: r.hasInvoice,
    hasCredit: r.hasCredit,
  }));

  return {
    items,
    total,
    page,
    perPage,
    totalPages: Math.max(1, Math.ceil(total / perPage)),
  };
}

// ─────────────────────────────────────────────
// Stats KPI + top clients + top produits
// ─────────────────────────────────────────────

export interface PfsStatsKpis {
  ordersCount: number;
  totalHT: number;
  totalTTC: number;
  avgBasketTTC: number;
  uniqueCustomers: number;
  itemsSold: number;
  newCustomers: number; // Fiches créées via l'import PFS sur la période
}

export interface PfsTopClientRow {
  adminClientCardId: string | null;
  pfsCustomerId: string;
  customerName: string;
  customerShop: string | null;
  customerCountry: string | null;
  ordersCount: number;
  totalHT: number;
  totalTTC: number;
  lastOrderAt: string | null;
}

export interface PfsTopProductRow {
  productId: string | null;
  productName: string | null;
  pfsProductRef: string;
  quantitySold: number;
  totalHT: number;
}

export interface PfsStatsBundle {
  period: PfsPeriodKey;
  kpis: PfsStatsKpis;
  topClients: PfsTopClientRow[];
  topProducts: PfsTopProductRow[];
  statusCounts: Record<"NEW" | "VALIDATED" | "SENT" | "CANCELLED", number>;
}

export interface GetPfsStatsInput {
  period: PfsPeriodKey;
  topClientsLimit?: number;
  topProductsLimit?: number;
  topClientsSort?: "totalHT" | "ordersCount";
  topProductsSort?: "quantity" | "totalHT";
}

export async function getPfsStats(input: GetPfsStatsInput): Promise<PfsStatsBundle> {
  await requireAdmin();
  const tenant = await requireCurrentTenant();
  const range = resolvePeriod(input.period);
  const topClientsLimit = Math.min(50, input.topClientsLimit ?? 10);
  const topProductsLimit = Math.min(50, input.topProductsLimit ?? 10);
  const topClientsSort = input.topClientsSort ?? "totalHT";
  const topProductsSort = input.topProductsSort ?? "quantity";

  const orderWhere = {
    tenantId: tenant.id,
    ...(range.from ? { createdAtPfs: { gte: range.from } } : {}),
  };

  const [ordersAggregate, itemsAggregate, statusRows, customerGrouped, itemGrouped, newCustomersCount] =
    await Promise.all([
      prisma.pfsOrder.aggregate({
        where: orderWhere,
        _count: { _all: true },
        _sum: { totalHT: true, totalTTC: true },
      }),
      prisma.pfsOrderItem.aggregate({
        where: { tenantId: tenant.id, pfsOrder: orderWhere },
        _sum: { qtyValidated: true },
      }),
      prisma.pfsOrder.groupBy({
        where: orderWhere,
        by: ["status"],
        _count: { _all: true },
      }),
      prisma.pfsOrder.groupBy({
        where: orderWhere,
        by: ["pfsCustomerId"],
        _count: { _all: true },
        _sum: { totalHT: true, totalTTC: true },
        _max: { createdAtPfs: true },
        orderBy:
          topClientsSort === "ordersCount"
            ? { _count: { pfsCustomerId: "desc" } }
            : { _sum: { totalHT: "desc" } },
        take: topClientsLimit,
      }),
      prisma.pfsOrderItem.groupBy({
        where: { tenantId: tenant.id, pfsOrder: orderWhere },
        by: ["pfsProductRef", "productId"],
        _sum: { qtyValidated: true, totalPriceHT: true },
        orderBy:
          topProductsSort === "quantity"
            ? { _sum: { qtyValidated: "desc" } }
            : { _sum: { totalPriceHT: "desc" } },
        take: topProductsLimit,
      }),
      prisma.adminClientCard.count({
        where: {
          tenantId: tenant.id,
          importedFromMarketplace: "PFS",
          ...(range.from ? { createdAt: { gte: range.from } } : {}),
        },
      }),
    ]);

  const ordersCount = ordersAggregate._count._all;
  const totalHT = decimalToNumber(ordersAggregate._sum.totalHT);
  const totalTTC = decimalToNumber(ordersAggregate._sum.totalTTC);
  const itemsSold = itemsAggregate._sum.qtyValidated ?? 0;
  const uniqueCustomers = customerGrouped.length; // sur la limite du top, mais uniqueCustomers doit être le total réel — refaire une count distinct
  // Correction : compter les distinct pfsCustomerId au vrai niveau
  const distinctCustomers = await prisma.pfsOrder.findMany({
    where: orderWhere,
    distinct: ["pfsCustomerId"],
    select: { pfsCustomerId: true },
  });

  const kpis: PfsStatsKpis = {
    ordersCount,
    totalHT,
    totalTTC,
    avgBasketTTC: ordersCount > 0 ? totalTTC / ordersCount : 0,
    uniqueCustomers: distinctCustomers.length,
    itemsSold,
    newCustomers: newCustomersCount,
  };

  // Enrichir top clients avec name/shop/country
  const topClientPfsIds = customerGrouped.map((c) => c.pfsCustomerId);
  const clientNameRows = topClientPfsIds.length
    ? await prisma.pfsOrder.findMany({
        where: { tenantId: tenant.id, pfsCustomerId: { in: topClientPfsIds } },
        distinct: ["pfsCustomerId"],
        orderBy: { createdAtPfs: "desc" },
        select: {
          pfsCustomerId: true,
          customerName: true,
          customerShop: true,
          customerCountry: true,
          adminClientCardId: true,
        },
      })
    : [];
  const clientNameMap = new Map(clientNameRows.map((r) => [r.pfsCustomerId, r]));

  const topClients: PfsTopClientRow[] = customerGrouped.map((c) => {
    const meta = clientNameMap.get(c.pfsCustomerId);
    return {
      adminClientCardId: meta?.adminClientCardId ?? null,
      pfsCustomerId: c.pfsCustomerId,
      customerName: meta?.customerName ?? "(inconnu)",
      customerShop: meta?.customerShop ?? null,
      customerCountry: meta?.customerCountry ?? null,
      ordersCount: c._count._all,
      totalHT: decimalToNumber(c._sum.totalHT),
      totalTTC: decimalToNumber(c._sum.totalTTC),
      lastOrderAt: c._max.createdAtPfs?.toISOString() ?? null,
    };
  });

  // Enrichir top produits avec le nom
  const productIds = itemGrouped.map((r) => r.productId).filter((x): x is string => Boolean(x));
  const productRows = productIds.length
    ? await prisma.product.findMany({
        where: { tenantId: tenant.id, id: { in: productIds } },
        select: { id: true, name: true },
      })
    : [];
  const productNameMap = new Map(productRows.map((p) => [p.id, p.name]));

  const topProducts: PfsTopProductRow[] = itemGrouped.map((r) => ({
    productId: r.productId,
    productName: r.productId ? productNameMap.get(r.productId) ?? null : null,
    pfsProductRef: r.pfsProductRef,
    quantitySold: r._sum.qtyValidated ?? 0,
    totalHT: decimalToNumber(r._sum.totalPriceHT),
  }));

  const statusCounts = {
    NEW: 0,
    VALIDATED: 0,
    SENT: 0,
    CANCELLED: 0,
  } as Record<"NEW" | "VALIDATED" | "SENT" | "CANCELLED", number>;
  for (const s of statusRows) {
    statusCounts[s.status] = s._count._all;
  }

  return {
    period: input.period,
    kpis,
    topClients,
    topProducts,
    statusCounts,
  };
}

// ─────────────────────────────────────────────
// Détail d'une commande + articles enrichis
// ─────────────────────────────────────────────

export interface PfsOrderItemDetail {
  id: string;
  pfsItemId: string;
  pfsProductRef: string;
  productId: string | null;
  productName: string | null;
  colorLabelFr: string | null;
  colorCodePfs: string | null;
  sizeLabel: string | null;
  sizeDetails: string | null;
  itemType: string;
  qtyOrdered: number;
  qtyValidated: number;
  unitPriceHT: number;
  totalPriceHT: number;
}

export interface PfsOrderDetailFull {
  id: string;
  pfsOrderId: string;
  orderNumber: string;
  createdAtPfs: string;
  status: "NEW" | "VALIDATED" | "SENT" | "CANCELLED";
  canceledAt: string | null;
  totalHT: number;
  totalTTC: number;
  vatAmount: number;
  vatRate: number;
  totalWeight: number | null;
  totalOrderedQty: number;
  totalValidatedQty: number;
  uniqueReferences: number;
  hasInvoice: boolean;
  hasCredit: boolean;
  carrier: string | null;
  paymentMethod: string | null;
  customerName: string;
  customerShop: string | null;
  customerCountry: string | null;
  adminClientCardId: string | null;
  statusTimeline: Array<{ status: string; timestamp: string; paymentMethod?: string }>;
  deliveryAddress: {
    street: string | null;
    postalCode: string | null;
    city: string | null;
    country: string | null;
  } | null;
  billingAddress: {
    street: string | null;
    postalCode: string | null;
    city: string | null;
    country: string | null;
  } | null;
  siret: string | null;
  vatNumber: string | null;
  phone: string | null;
  items: PfsOrderItemDetail[];
}

export async function getPfsOrderDetail(orderId: string): Promise<PfsOrderDetailFull | null> {
  await requireAdmin();
  const tenant = await requireCurrentTenant();
  const row = await prisma.pfsOrder.findFirst({
    where: { tenantId: tenant.id, id: orderId },
    include: {
      items: {
        include: { product: { select: { id: true, name: true } } },
        orderBy: { createdAt: "asc" },
      },
    },
  });
  if (!row) return null;

  const raw = row.rawDetailJson as {
    customer?: {
      identification_numbers?: { siret?: string | null; vat?: string | null };
      phone?: string | null;
      delivery_address?: { street?: string | null; postal_code?: string | null; city?: string | null; country?: string | null } | null;
      billing_address?: { street?: string | null; postal_code?: string | null; city?: string | null; country?: string | null } | null;
    };
  } | null;

  const cust = raw?.customer ?? undefined;
  const delivery = cust?.delivery_address
    ? {
        street: cust.delivery_address.street ?? null,
        postalCode: cust.delivery_address.postal_code ?? null,
        city: cust.delivery_address.city ?? null,
        country: cust.delivery_address.country ?? null,
      }
    : null;
  const billing = cust?.billing_address
    ? {
        street: cust.billing_address.street ?? null,
        postalCode: cust.billing_address.postal_code ?? null,
        city: cust.billing_address.city ?? null,
        country: cust.billing_address.country ?? null,
      }
    : null;

  const timeline = Array.isArray(row.statusTimelineJson)
    ? (row.statusTimelineJson as Array<{ status: string; timestamp: string; payment_method?: string }>).map((t) => ({
        status: t.status,
        timestamp: t.timestamp,
        paymentMethod: t.payment_method,
      }))
    : [];

  return {
    id: row.id,
    pfsOrderId: row.pfsOrderId,
    orderNumber: row.orderNumber,
    createdAtPfs: row.createdAtPfs.toISOString(),
    status: row.status,
    canceledAt: row.canceledAt?.toISOString() ?? null,
    totalHT: decimalToNumber(row.totalHT),
    totalTTC: decimalToNumber(row.totalTTC),
    vatAmount: decimalToNumber(row.vatAmount),
    vatRate: decimalToNumber(row.vatRate),
    totalWeight: row.totalWeight != null ? decimalToNumber(row.totalWeight) : null,
    totalOrderedQty: row.totalOrderedQty,
    totalValidatedQty: row.totalValidatedQty,
    uniqueReferences: row.uniqueReferences,
    hasInvoice: row.hasInvoice,
    hasCredit: row.hasCredit,
    carrier: row.carrier,
    paymentMethod: row.paymentMethod,
    customerName: row.customerName,
    customerShop: row.customerShop,
    customerCountry: row.customerCountry,
    adminClientCardId: row.adminClientCardId,
    statusTimeline: timeline,
    deliveryAddress: delivery,
    billingAddress: billing,
    siret: cust?.identification_numbers?.siret ?? null,
    vatNumber: cust?.identification_numbers?.vat ?? null,
    phone: cust?.phone ?? null,
    items: row.items.map((it) => ({
      id: it.id,
      pfsItemId: it.pfsItemId,
      pfsProductRef: it.pfsProductRef,
      productId: it.productId,
      productName: it.product?.name ?? it.productSnapshotName ?? null,
      colorLabelFr: it.colorLabelFr,
      colorCodePfs: it.colorCodePfs,
      sizeLabel: it.sizeLabel,
      sizeDetails: it.sizeDetails,
      itemType: it.itemType,
      qtyOrdered: it.qtyOrdered,
      qtyValidated: it.qtyValidated,
      unitPriceHT: decimalToNumber(it.unitPriceHT),
      totalPriceHT: decimalToNumber(it.totalPriceHT),
    })),
  };
}

// ─────────────────────────────────────────────
// Sync manuelle + import historique
// ─────────────────────────────────────────────

export async function syncPfsOrdersNow(): Promise<
  | { success: true; created: number; updated: number; scanned: number }
  | { success: false; error: string }
> {
  try {
    await requireAdmin();
    const tenant = await requireCurrentTenant();
    const res = await syncRecentPfsOrders(tenant.id);
    revalidatePath("/admin/commandes");
    return { success: true, ...res };
  } catch (err) {
    logger.error("[PFS Orders] syncPfsOrdersNow échec", { error: err as Error });
    return {
      success: false,
      error: err instanceof Error ? err.message : "Erreur inconnue",
    };
  }
}

export async function resyncPfsOrderById(
  orderId: string,
): Promise<{ success: true } | { success: false; error: string }> {
  try {
    await requireAdmin();
    const tenant = await requireCurrentTenant();
    const row = await prisma.pfsOrder.findFirst({
      where: { tenantId: tenant.id, id: orderId },
      select: { pfsOrderId: true },
    });
    if (!row) return { success: false, error: "Commande introuvable." };
    await syncSinglePfsOrder(tenant.id, row.pfsOrderId);
    revalidatePath("/admin/commandes");
    return { success: true };
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : "Erreur inconnue" };
  }
}

export async function startPfsHistoricalImport(): Promise<PfsImportState> {
  await requireAdmin();
  const tenant = await requireCurrentTenant();
  return startPfsHistoricalImportInBackground(tenant.id);
}

export async function stopPfsHistoricalImport(): Promise<{ success: true }> {
  await requireAdmin();
  const tenant = await requireCurrentTenant();
  await requestStopPfsHistoricalImport(tenant.id);
  return { success: true };
}

export async function acknowledgePfsHistoricalImport(): Promise<{ success: true }> {
  await requireAdmin();
  const tenant = await requireCurrentTenant();
  await resetPfsImportState(tenant.id);
  return { success: true };
}

export async function getPfsImportStateAction(): Promise<PfsImportState> {
  await requireAdmin();
  const tenant = await requireCurrentTenant();
  return getPfsImportState(tenant.id);
}

export async function getPfsSyncMeta(): Promise<{
  lastSyncedAt: string | null;
  totalOrdersInDb: number;
  hasCredentials: boolean;
}> {
  await requireAdmin();
  const tenant = await requireCurrentTenant();
  const [lastSyncRow, credsRows, totalOrdersInDb] = await Promise.all([
    prisma.siteConfig.findFirst({
      where: { tenantId: tenant.id, key: "pfs_orders_last_synced_at" },
      select: { value: true },
    }),
    prisma.siteConfig.findMany({
      where: { tenantId: tenant.id, key: { in: ["pfs_email", "pfs_password"] } },
      select: { key: true, value: true },
    }),
    prisma.pfsOrder.count({ where: { tenantId: tenant.id } }),
  ]);

  const credsMap = new Map(credsRows.map((r) => [r.key, r.value]));
  const hasCredentials =
    (credsMap.get("pfs_email") || "").trim().length > 0 &&
    (credsMap.get("pfs_password") || "").trim().length > 0;

  const lastSyncedAt = lastSyncRow?.value
    ? new Date(parseInt(lastSyncRow.value, 10)).toISOString()
    : null;

  return { lastSyncedAt, totalOrdersInDb, hasCredentials };
}

/** Liste les commandes PFS d'un client donné (pour AdminCardDrawer). */
export async function listPfsOrdersForClientCard(adminClientCardId: string): Promise<PfsOrderListItem[]> {
  await requireAdmin();
  const tenant = await requireCurrentTenant();
  const rows = await prisma.pfsOrder.findMany({
    where: { tenantId: tenant.id, adminClientCardId },
    orderBy: { createdAtPfs: "desc" },
    select: {
      id: true,
      pfsOrderId: true,
      orderNumber: true,
      createdAtPfs: true,
      status: true,
      customerName: true,
      customerShop: true,
      customerCountry: true,
      carrier: true,
      totalTTC: true,
      totalHT: true,
      hasInvoice: true,
      hasCredit: true,
    },
  });
  return rows.map((r) => ({
    id: r.id,
    pfsOrderId: r.pfsOrderId,
    orderNumber: r.orderNumber,
    createdAtPfs: r.createdAtPfs.toISOString(),
    status: r.status,
    customerName: r.customerName,
    customerShop: r.customerShop,
    customerCountry: r.customerCountry,
    carrier: r.carrier,
    totalTTC: decimalToNumber(r.totalTTC),
    totalHT: decimalToNumber(r.totalHT),
    hasInvoice: r.hasInvoice,
    hasCredit: r.hasCredit,
  }));
}

/** Force la revalidation du cache commandes (invalidateur pour l'UI). */
export async function invalidatePfsOrdersCache(): Promise<void> {
  await requireAdmin();
  revalidatePath("/admin/commandes");
  revalidatePath("/admin/utilisateurs");
  revalidateTag("pfs-orders", "default");
}
