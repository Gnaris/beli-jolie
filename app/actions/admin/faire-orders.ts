"use server";

import { getServerSession } from "next-auth";
import { revalidatePath, revalidateTag } from "next/cache";
import { Prisma } from "@prisma/client";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { requireCurrentTenant } from "@/lib/tenant";
import { logger } from "@/lib/logger";
import {
  getFaireImportState,
  startFaireHistoricalImportInBackground,
  requestStopFaireHistoricalImport,
  resetFaireImportState,
} from "@/lib/faire-orders-import-state";
export type {
  FaireImportState,
  FaireImportRecentEvent,
  FaireImportCurrentOrder,
} from "@/lib/faire-orders-import-state";
import type { FaireImportState } from "@/lib/faire-orders-import-state";
import { syncRecentFaireOrders, upsertFaireOrderFromResource } from "@/lib/faire-orders-sync";
import { faireGetOrder } from "@/lib/faire-orders-api";

async function requireAdmin() {
  const session = await getServerSession(authOptions);
  if (!session || session.user.role !== "ADMIN") {
    throw new Error("Accès non autorisé.");
  }
  return session;
}

export type FairePeriodKey =
  | "today"
  | "3d"
  | "week"
  | "15d"
  | "month"
  | "3m"
  | "6m"
  | "year"
  | "all"
  | "custom";

interface PeriodRange {
  from: Date | null;
  to: Date | null;
}

function subDays(base: Date, days: number): Date {
  const d = new Date(base);
  d.setDate(d.getDate() - days);
  return d;
}

function parseYmd(ymd: string | null | undefined, endOfDay = false): Date | null {
  if (!ymd) return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(ymd);
  if (!m) return null;
  const [, y, mo, d] = m;
  const date = endOfDay
    ? new Date(Number(y), Number(mo) - 1, Number(d), 23, 59, 59, 999)
    : new Date(Number(y), Number(mo) - 1, Number(d), 0, 0, 0, 0);
  return Number.isNaN(date.getTime()) ? null : date;
}

function resolvePeriod(
  period: FairePeriodKey,
  customFrom?: string | null,
  customTo?: string | null,
): PeriodRange {
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
    case "custom":
      return { from: parseYmd(customFrom), to: parseYmd(customTo, true) };
    case "all":
    default:
      return { from: null, to: null };
  }
}

function decimalToNumber(d: Prisma.Decimal | number | null | undefined): number {
  if (d == null) return 0;
  if (typeof d === "number") return d;
  return Number(d.toString());
}

// ─────────────────────────────────────────────
// Liste paginée
// ─────────────────────────────────────────────

export interface ListFaireOrdersInput {
  q?: string;
  status?: "NEW" | "SHIPPED" | "CANCELLED";
  page?: number;
  perPage?: number;
  period?: FairePeriodKey;
  customFrom?: string | null;
  customTo?: string | null;
}

export interface FaireOrderListItem {
  id: string;
  faireOrderId: string;
  displayId: string | null;
  createdAtFaire: string;
  shippedAt: string | null;
  status: "NEW" | "SHIPPED" | "CANCELLED";
  statusRaw: string;
  customerName: string;
  customerShop: string | null;
  customerCountry: string | null;
  carrier: string | null;
  trackingCode: string | null;
  totalHT: number;
  netAmount: number;
}

export interface ListFaireOrdersResult {
  items: FaireOrderListItem[];
  total: number;
  page: number;
  perPage: number;
  totalPages: number;
}

export async function listFaireOrders(
  input: ListFaireOrdersInput,
): Promise<ListFaireOrdersResult> {
  await requireAdmin();
  const tenant = await requireCurrentTenant();
  const page = Math.max(1, input.page ?? 1);
  const perPage = Math.min(200, Math.max(1, input.perPage ?? 30));
  const range = resolvePeriod(input.period ?? "all", input.customFrom, input.customTo);

  const createdAtFilter: { gte?: Date; lte?: Date } = {};
  if (range.from) createdAtFilter.gte = range.from;
  if (range.to) createdAtFilter.lte = range.to;

  const where: Prisma.FaireOrderWhereInput = {
    tenantId: tenant.id,
    ...(input.status ? { status: input.status } : {}),
    ...(Object.keys(createdAtFilter).length ? { createdAtFaire: createdAtFilter } : {}),
    ...(input.q
      ? {
          OR: [
            { displayId: { contains: input.q } },
            { faireOrderId: { contains: input.q } },
            { customerName: { contains: input.q } },
            { customerShop: { contains: input.q } },
            { customerCountry: { contains: input.q } },
            { trackingCode: { contains: input.q } },
          ],
        }
      : {}),
  };

  const [rows, total] = await Promise.all([
    prisma.faireOrder.findMany({
      where,
      orderBy: { createdAtFaire: "desc" },
      skip: (page - 1) * perPage,
      take: perPage,
      select: {
        id: true,
        faireOrderId: true,
        displayId: true,
        createdAtFaire: true,
        shippedAt: true,
        status: true,
        statusRaw: true,
        customerName: true,
        customerShop: true,
        customerCountry: true,
        carrier: true,
        trackingCode: true,
        totalHT: true,
        netAmount: true,
      },
    }),
    prisma.faireOrder.count({ where }),
  ]);

  return {
    items: rows.map((r) => ({
      id: r.id,
      faireOrderId: r.faireOrderId,
      displayId: r.displayId,
      createdAtFaire: r.createdAtFaire.toISOString(),
      shippedAt: r.shippedAt?.toISOString() ?? null,
      status: r.status,
      statusRaw: r.statusRaw,
      customerName: r.customerName,
      customerShop: r.customerShop,
      customerCountry: r.customerCountry,
      carrier: r.carrier,
      trackingCode: r.trackingCode,
      totalHT: decimalToNumber(r.totalHT),
      netAmount: decimalToNumber(r.netAmount),
    })),
    total,
    page,
    perPage,
    totalPages: Math.max(1, Math.ceil(total / perPage)),
  };
}

// ─────────────────────────────────────────────
// Détail d'une commande + articles
// ─────────────────────────────────────────────

export interface FaireOrderItemDetail {
  id: string;
  faireItemId: string;
  sku: string | null;
  referenceBase: string | null;
  productId: string | null;
  productName: string | null;
  variantOptionLabel: string | null;
  quantity: number;
  unitPriceHT: number;
  totalPriceHT: number;
  includesTester: boolean;
}

export interface FaireOrderDetailFull {
  id: string;
  faireOrderId: string;
  displayId: string | null;
  createdAtFaire: string;
  updatedAtFaire: string | null;
  shipAfter: string | null;
  shippedAt: string | null;
  canceledAt: string | null;
  status: "NEW" | "SHIPPED" | "CANCELLED";
  statusRaw: string;
  faireSource: string | null;
  currency: string;
  totalHT: number;
  commissionAmount: number;
  payoutFeeAmount: number;
  netAmount: number;
  customerName: string;
  customerShop: string | null;
  customerEmail: string | null;
  customerPhone: string | null;
  customerCountry: string | null;
  adminClientCardId: string | null;
  shippingAddress: {
    name: string | null;
    company: string | null;
    street: string | null;
    street2: string | null;
    city: string | null;
    stateCode: string | null;
    postalCode: string | null;
    country: string | null;
    phone: string | null;
  } | null;
  carrier: string | null;
  trackingCode: string | null;
  trackingUrl: string | null;
  items: FaireOrderItemDetail[];
}

export async function getFaireOrderDetail(orderId: string): Promise<FaireOrderDetailFull | null> {
  await requireAdmin();
  const tenant = await requireCurrentTenant();
  const row = await prisma.faireOrder.findFirst({
    where: { tenantId: tenant.id, id: orderId },
    include: {
      items: {
        include: { product: { select: { id: true, name: true } } },
        orderBy: { createdAt: "asc" },
      },
    },
  });
  if (!row) return null;

  const shippingAddress =
    row.shippingName || row.shippingStreet || row.shippingCompany
      ? {
          name: row.shippingName,
          company: row.shippingCompany,
          street: row.shippingStreet,
          street2: row.shippingStreet2,
          city: row.shippingCity,
          stateCode: row.shippingStateCode,
          postalCode: row.shippingPostalCode,
          country: row.shippingCountryCode,
          phone: row.shippingPhone,
        }
      : null;

  return {
    id: row.id,
    faireOrderId: row.faireOrderId,
    displayId: row.displayId,
    createdAtFaire: row.createdAtFaire.toISOString(),
    updatedAtFaire: row.updatedAtFaire?.toISOString() ?? null,
    shipAfter: row.shipAfter?.toISOString() ?? null,
    shippedAt: row.shippedAt?.toISOString() ?? null,
    canceledAt: row.canceledAt?.toISOString() ?? null,
    status: row.status,
    statusRaw: row.statusRaw,
    faireSource: row.faireSource,
    currency: row.currency,
    totalHT: decimalToNumber(row.totalHT),
    commissionAmount: decimalToNumber(row.commissionAmount),
    payoutFeeAmount: decimalToNumber(row.payoutFeeAmount),
    netAmount: decimalToNumber(row.netAmount),
    customerName: row.customerName,
    customerShop: row.customerShop,
    customerEmail: row.customerEmail,
    customerPhone: row.customerPhone,
    customerCountry: row.customerCountry,
    adminClientCardId: row.adminClientCardId,
    shippingAddress,
    carrier: row.carrier,
    trackingCode: row.trackingCode,
    trackingUrl: row.trackingUrl,
    items: row.items.map((it) => ({
      id: it.id,
      faireItemId: it.faireItemId,
      sku: it.sku,
      referenceBase: it.referenceBase,
      productId: it.productId,
      productName: it.product?.name ?? it.productSnapshotName ?? null,
      variantOptionLabel: it.variantOptionLabel,
      quantity: it.quantity,
      unitPriceHT: decimalToNumber(it.unitPriceHT),
      totalPriceHT: decimalToNumber(it.totalPriceHT),
      includesTester: it.includesTester,
    })),
  };
}

// ─────────────────────────────────────────────
// Sync manuelle + import historique
// ─────────────────────────────────────────────

export async function syncFaireOrdersNow(): Promise<
  | { success: true; created: number; updated: number; scanned: number }
  | { success: false; error: string }
> {
  let tenantIdForMark: string | null = null;
  try {
    await requireAdmin();
    const tenant = await requireCurrentTenant();
    tenantIdForMark = tenant.id;
    const res = await syncRecentFaireOrders(tenant.id);
    revalidatePath("/admin/commandes");
    return { success: true, ...res };
  } catch (err) {
    logger.error("[Faire Orders] syncFaireOrdersNow échec", { error: err as Error });
    return { success: false, error: err instanceof Error ? err.message : "Erreur inconnue" };
  } finally {
    if (tenantIdForMark) {
      await prisma.siteConfig
        .upsert({
          where: {
            tenantId_key: { tenantId: tenantIdForMark, key: "faire_orders_last_synced_at" },
          },
          update: { value: String(Date.now()) },
          create: {
            tenantId: tenantIdForMark,
            key: "faire_orders_last_synced_at",
            value: String(Date.now()),
          },
        })
        .catch(() => {});
    }
  }
}

export async function resyncFaireOrderById(
  orderId: string,
): Promise<{ success: true } | { success: false; error: string }> {
  try {
    await requireAdmin();
    const tenant = await requireCurrentTenant();
    const row = await prisma.faireOrder.findFirst({
      where: { tenantId: tenant.id, id: orderId },
      select: { faireOrderId: true },
    });
    if (!row) return { success: false, error: "Commande introuvable." };
    const detail = await faireGetOrder(row.faireOrderId);
    if (!detail) return { success: false, error: "Commande absente côté Faire (404)." };
    await upsertFaireOrderFromResource(tenant.id, detail);
    revalidatePath("/admin/commandes");
    return { success: true };
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : "Erreur inconnue" };
  }
}

export async function startFaireHistoricalImport(): Promise<FaireImportState> {
  await requireAdmin();
  const tenant = await requireCurrentTenant();
  return startFaireHistoricalImportInBackground(tenant.id);
}

export async function stopFaireHistoricalImport(): Promise<{ success: true }> {
  await requireAdmin();
  const tenant = await requireCurrentTenant();
  await requestStopFaireHistoricalImport(tenant.id);
  return { success: true };
}

export async function acknowledgeFaireHistoricalImport(): Promise<{ success: true }> {
  await requireAdmin();
  const tenant = await requireCurrentTenant();
  await resetFaireImportState(tenant.id);
  return { success: true };
}

export async function getFaireImportStateAction(): Promise<FaireImportState> {
  await requireAdmin();
  const tenant = await requireCurrentTenant();
  return getFaireImportState(tenant.id);
}

// ─────────────────────────────────────────────
// Déduction du stock (preview + run) — commande unique
// ─────────────────────────────────────────────

export type FaireSingleOrderDeductionPreview = Awaited<
  ReturnType<typeof import("@/lib/faire-stock-deduction").simulateFaireStockDeductionForOrder>
>;

export async function previewFaireOrderStockDeduction(
  orderId: string,
): Promise<
  | { success: true; preview: NonNullable<FaireSingleOrderDeductionPreview> }
  | { success: false; error: string }
> {
  await requireAdmin();
  const tenant = await requireCurrentTenant();
  try {
    const { simulateFaireStockDeductionForOrder } = await import(
      "@/lib/faire-stock-deduction"
    );
    const preview = await simulateFaireStockDeductionForOrder(tenant.id, orderId);
    if (!preview) return { success: false, error: "Commande introuvable." };
    return { success: true, preview };
  } catch (err) {
    logger.error("[Faire Stock] Preview échouée", { error: err as Error });
    return { success: false, error: err instanceof Error ? err.message : "Erreur inconnue" };
  }
}

export async function runFaireOrderStockDeductionOne(
  orderId: string,
): Promise<
  | {
      success: true;
      processedCount: number;
      skippedCount: number;
      touchedProductIds: string[];
    }
  | { success: false; error: string }
> {
  const session = await requireAdmin();
  const tenant = await requireCurrentTenant();
  try {
    const { deductStockFromFaireOrders } = await import("@/lib/faire-stock-deduction");
    const result = await deductStockFromFaireOrders(tenant.id, session.user.id ?? null, [orderId]);
    if (result.touchedProductIds.length > 0) {
      revalidateTag("products", "default");
      revalidateTag("dashboard-stats", "default");
      revalidatePath("/admin/produits");
    }
    revalidatePath("/admin/commandes");
    return {
      success: true,
      processedCount: result.processedCount,
      skippedCount: result.skipped.length,
      touchedProductIds: result.touchedProductIds,
    };
  } catch (err) {
    logger.error("[Faire Stock] Déduction commande unique échouée", { error: err as Error });
    return { success: false, error: err instanceof Error ? err.message : "Erreur inconnue" };
  }
}

export async function getFaireOrdersSyncMeta(): Promise<{
  lastSyncedAt: string | null;
  totalOrdersInDb: number;
  hasCredentials: boolean;
}> {
  await requireAdmin();
  const tenant = await requireCurrentTenant();
  const [lastSyncRow, apiKeyRow, totalOrdersInDb] = await Promise.all([
    prisma.siteConfig.findFirst({
      where: { tenantId: tenant.id, key: "faire_orders_last_synced_at" },
      select: { value: true },
    }),
    prisma.siteConfig.findFirst({
      where: { tenantId: tenant.id, key: "faire_api_key" },
      select: { value: true },
    }),
    prisma.faireOrder.count({ where: { tenantId: tenant.id } }),
  ]);
  const hasCredentials = (apiKeyRow?.value || "").trim().length > 0;
  const lastSyncedAt = lastSyncRow?.value
    ? new Date(parseInt(lastSyncRow.value, 10)).toISOString()
    : null;
  return { lastSyncedAt, totalOrdersInDb, hasCredentials };
}
