"use server";

import { getServerSession } from "next-auth";
import { revalidatePath, revalidateTag } from "next/cache";
import { Prisma } from "@prisma/client";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { requireCurrentTenant } from "@/lib/tenant";
import { logger } from "@/lib/logger";
import {
  getAnkorstoreImportState,
  startAnkorstoreHistoricalImportInBackground,
  requestStopAnkorstoreHistoricalImport,
  resetAnkorstoreImportState,
} from "@/lib/ankorstore-orders-import-state";
export type {
  AnkorstoreImportState,
  AnkorstoreImportRecentEvent,
  AnkorstoreImportCurrentOrder,
} from "@/lib/ankorstore-orders-import-state";
import type { AnkorstoreImportState } from "@/lib/ankorstore-orders-import-state";
import {
  syncRecentAnkorstoreOrders,
  upsertAnkorstoreOrderFromResource,
} from "@/lib/ankorstore-orders-sync";
import { ankorstoreGetOrderDetail } from "@/lib/ankorstore-orders-api";

async function requireAdmin() {
  const session = await getServerSession(authOptions);
  if (!session || session.user.role !== "ADMIN") {
    throw new Error("Accès non autorisé.");
  }
  return session;
}

export type AnkorstorePeriodKey =
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
  period: AnkorstorePeriodKey,
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

export interface ListAnkorstoreOrdersInput {
  q?: string;
  status?: "NEW" | "VALIDATED" | "SHIPPED" | "CANCELLED";
  page?: number;
  perPage?: number;
  period?: AnkorstorePeriodKey;
  customFrom?: string | null;
  customTo?: string | null;
}

export interface AnkorstoreOrderListItem {
  id: string;
  ankorstoreOrderId: string;
  reference: string;
  createdAtAnkor: string;
  submittedAt: string | null;
  shippedAt: string | null;
  status: "NEW" | "VALIDATED" | "SHIPPED" | "CANCELLED";
  statusRaw: string;
  customerName: string;
  customerShop: string | null;
  customerCountry: string | null;
  carrier: string | null;
  trackingNumber: string | null;
  trackingStatus: string | null;
  totalHT: number;
  totalTTC: number;
}

export interface ListAnkorstoreOrdersResult {
  items: AnkorstoreOrderListItem[];
  total: number;
  page: number;
  perPage: number;
  totalPages: number;
}

export async function listAnkorstoreOrders(
  input: ListAnkorstoreOrdersInput,
): Promise<ListAnkorstoreOrdersResult> {
  await requireAdmin();
  const tenant = await requireCurrentTenant();
  const page = Math.max(1, input.page ?? 1);
  const perPage = Math.min(200, Math.max(1, input.perPage ?? 30));
  const range = resolvePeriod(input.period ?? "all", input.customFrom, input.customTo);

  const createdAtFilter: { gte?: Date; lte?: Date } = {};
  if (range.from) createdAtFilter.gte = range.from;
  if (range.to) createdAtFilter.lte = range.to;

  const where: Prisma.AnkorstoreOrderWhereInput = {
    tenantId: tenant.id,
    ...(input.status ? { status: input.status } : {}),
    ...(Object.keys(createdAtFilter).length ? { createdAtAnkor: createdAtFilter } : {}),
    ...(input.q
      ? {
          OR: [
            { reference: { contains: input.q } },
            { customerName: { contains: input.q } },
            { customerShop: { contains: input.q } },
            { customerCountry: { contains: input.q } },
            { trackingNumber: { contains: input.q } },
          ],
        }
      : {}),
  };

  const [rows, total] = await Promise.all([
    prisma.ankorstoreOrder.findMany({
      where,
      orderBy: { createdAtAnkor: "desc" },
      skip: (page - 1) * perPage,
      take: perPage,
      select: {
        id: true,
        ankorstoreOrderId: true,
        reference: true,
        createdAtAnkor: true,
        submittedAt: true,
        shippedAt: true,
        status: true,
        statusRaw: true,
        customerName: true,
        customerShop: true,
        customerCountry: true,
        carrier: true,
        trackingNumber: true,
        trackingStatus: true,
        brandTotalAmount: true,
        brandTotalAmountWithVat: true,
      },
    }),
    prisma.ankorstoreOrder.count({ where }),
  ]);

  return {
    items: rows.map((r) => ({
      id: r.id,
      ankorstoreOrderId: r.ankorstoreOrderId,
      reference: r.reference,
      createdAtAnkor: r.createdAtAnkor.toISOString(),
      submittedAt: r.submittedAt?.toISOString() ?? null,
      shippedAt: r.shippedAt?.toISOString() ?? null,
      status: r.status,
      statusRaw: r.statusRaw,
      customerName: r.customerName,
      customerShop: r.customerShop,
      customerCountry: r.customerCountry,
      carrier: r.carrier,
      trackingNumber: r.trackingNumber,
      trackingStatus: r.trackingStatus,
      totalHT: decimalToNumber(r.brandTotalAmount),
      totalTTC: decimalToNumber(r.brandTotalAmountWithVat),
    })),
    total,
    page,
    perPage,
    totalPages: Math.max(1, Math.ceil(total / perPage)),
  };
}

export interface AnkorstoreOrderItemDetail {
  id: string;
  ankorstoreItemId: string;
  sku: string;
  referenceBase: string | null;
  productId: string | null;
  productName: string | null;
  variantOptionLabel: string | null;
  quantity: number;
  multipliedQuantity: number;
  unitPriceHT: number;
  totalPriceHT: number;
  vatAmount: number;
  totalWithVat: number;
}

export interface AnkorstoreBillingItemDetail {
  type: string;
  amountHT: number;
  amountVat: number;
  amountTTC: number;
}

export interface AnkorstoreOrderDetailFull {
  id: string;
  ankorstoreOrderId: string;
  reference: string;
  createdAtAnkor: string;
  submittedAt: string | null;
  shippedAt: string | null;
  brandPaidAt: string | null;
  canceledAt: string | null;
  status: "NEW" | "VALIDATED" | "SHIPPED" | "CANCELLED";
  statusRaw: string;
  currency: string;
  brandNetAmount: number;
  brandTotalAmount: number;
  brandTotalAmountVat: number;
  brandTotalAmountWithVat: number;
  brandRejectReason: string | null;
  retailerRejectReason: string | null;
  retailerCancellationRequestReason: string | null;
  customerName: string;
  customerShop: string | null;
  customerEmail: string | null;
  customerPhone: string | null;
  customerVatNumber: string | null;
  customerSiret: string | null;
  adminClientCardId: string | null;
  billingAddress: {
    name: string | null;
    organisation: string | null;
    street: string | null;
    postalCode: string | null;
    city: string | null;
    country: string | null;
  } | null;
  shippingAddress: {
    name: string | null;
    organisation: string | null;
    street: string | null;
    postalCode: string | null;
    city: string | null;
    country: string | null;
  } | null;
  shippingMethod: string | null;
  carrier: string | null;
  trackingNumber: string | null;
  trackingLink: string | null;
  trackingStatus: string | null;
  trackingStatusDetails: string | null;
  trackingUpdatedAt: string | null;
  items: AnkorstoreOrderItemDetail[];
  billingItems: AnkorstoreBillingItemDetail[];
}

export async function getAnkorstoreOrderDetail(
  orderId: string,
): Promise<AnkorstoreOrderDetailFull | null> {
  await requireAdmin();
  const tenant = await requireCurrentTenant();
  const row = await prisma.ankorstoreOrder.findFirst({
    where: { tenantId: tenant.id, id: orderId },
    include: {
      items: {
        include: { product: { select: { id: true, name: true } } },
        orderBy: { createdAt: "asc" },
      },
    },
  });
  if (!row) return null;

  const billingItems: AnkorstoreBillingItemDetail[] = Array.isArray(row.billingItemsJson)
    ? (row.billingItemsJson as Array<{
        attributes?: { type?: string; amount?: number; amountVat?: number; amountWithVat?: number };
      }>).map((bi) => ({
        type: bi.attributes?.type ?? "unknown",
        amountHT: (bi.attributes?.amount ?? 0) / 100,
        amountVat: (bi.attributes?.amountVat ?? 0) / 100,
        amountTTC: (bi.attributes?.amountWithVat ?? 0) / 100,
      }))
    : [];

  const billingAddress =
    row.billingName || row.billingStreet
      ? {
          name: row.billingName,
          organisation: row.billingOrganisationName,
          street: row.billingStreet,
          postalCode: row.billingPostalCode,
          city: row.billingCity,
          country: row.billingCountryCode,
        }
      : null;
  const shippingAddress =
    row.shippingName || row.shippingStreet
      ? {
          name: row.shippingName,
          organisation: row.shippingOrganisationName,
          street: row.shippingStreet,
          postalCode: row.shippingPostalCode,
          city: row.shippingCity,
          country: row.shippingCountryCode,
        }
      : null;

  return {
    id: row.id,
    ankorstoreOrderId: row.ankorstoreOrderId,
    reference: row.reference,
    createdAtAnkor: row.createdAtAnkor.toISOString(),
    submittedAt: row.submittedAt?.toISOString() ?? null,
    shippedAt: row.shippedAt?.toISOString() ?? null,
    brandPaidAt: row.brandPaidAt?.toISOString() ?? null,
    canceledAt: row.canceledAt?.toISOString() ?? null,
    status: row.status,
    statusRaw: row.statusRaw,
    currency: row.currency,
    brandNetAmount: decimalToNumber(row.brandNetAmount),
    brandTotalAmount: decimalToNumber(row.brandTotalAmount),
    brandTotalAmountVat: decimalToNumber(row.brandTotalAmountVat),
    brandTotalAmountWithVat: decimalToNumber(row.brandTotalAmountWithVat),
    brandRejectReason: row.brandRejectReason,
    retailerRejectReason: row.retailerRejectReason,
    retailerCancellationRequestReason: row.retailerCancellationRequestReason,
    customerName: row.customerName,
    customerShop: row.customerShop,
    customerEmail: row.customerEmail,
    customerPhone: row.customerPhone,
    customerVatNumber: row.customerVatNumber,
    customerSiret: row.customerSiret,
    adminClientCardId: row.adminClientCardId,
    billingAddress,
    shippingAddress,
    shippingMethod: row.shippingMethod,
    carrier: row.carrier,
    trackingNumber: row.trackingNumber,
    trackingLink: row.trackingLink,
    trackingStatus: row.trackingStatus,
    trackingStatusDetails: row.trackingStatusDetails,
    trackingUpdatedAt: row.trackingUpdatedAt?.toISOString() ?? null,
    items: row.items.map((it) => ({
      id: it.id,
      ankorstoreItemId: it.ankorstoreItemId,
      sku: it.sku,
      referenceBase: it.referenceBase,
      productId: it.productId,
      productName: it.product?.name ?? it.productSnapshotName ?? null,
      variantOptionLabel: it.variantOptionLabel,
      quantity: it.quantity,
      multipliedQuantity: it.multipliedQuantity,
      unitPriceHT: decimalToNumber(it.unitPriceHT),
      totalPriceHT: decimalToNumber(it.totalPriceHT),
      vatAmount: decimalToNumber(it.vatAmount),
      totalWithVat: decimalToNumber(it.totalWithVat),
    })),
    billingItems,
  };
}

export async function syncAnkorstoreOrdersNow(): Promise<
  | { success: true; created: number; updated: number; scanned: number }
  | { success: false; error: string }
> {
  let tenantIdForMark: string | null = null;
  try {
    await requireAdmin();
    const tenant = await requireCurrentTenant();
    tenantIdForMark = tenant.id;
    const res = await syncRecentAnkorstoreOrders(tenant.id);
    revalidatePath("/admin/commandes");
    return { success: true, ...res };
  } catch (err) {
    logger.error("[Ankorstore Orders] syncAnkorstoreOrdersNow échec", { error: err as Error });
    return { success: false, error: err instanceof Error ? err.message : "Erreur inconnue" };
  } finally {
    // Marque l'instant du tick même en cas d'échec, pour que le compteur
    // « Prochaine auto dans mm:ss » reparte à zéro dès qu'on tente une sync.
    if (tenantIdForMark) {
      await prisma.siteConfig
        .upsert({
          where: { tenantId_key: { tenantId: tenantIdForMark, key: "ankorstore_orders_last_synced_at" } },
          update: { value: String(Date.now()) },
          create: {
            tenantId: tenantIdForMark,
            key: "ankorstore_orders_last_synced_at",
            value: String(Date.now()),
          },
        })
        .catch(() => {});
    }
  }
}

export async function resyncAnkorstoreOrderById(
  orderId: string,
): Promise<{ success: true } | { success: false; error: string }> {
  try {
    await requireAdmin();
    const tenant = await requireCurrentTenant();
    const row = await prisma.ankorstoreOrder.findFirst({
      where: { tenantId: tenant.id, id: orderId },
      select: { ankorstoreOrderId: true },
    });
    if (!row) return { success: false, error: "Commande introuvable." };
    const detail = await ankorstoreGetOrderDetail(row.ankorstoreOrderId);
    await upsertAnkorstoreOrderFromResource(tenant.id, detail.data, detail.included);
    revalidatePath("/admin/commandes");
    return { success: true };
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : "Erreur inconnue" };
  }
}

export async function startAnkorstoreHistoricalImport(): Promise<AnkorstoreImportState> {
  await requireAdmin();
  const tenant = await requireCurrentTenant();
  return startAnkorstoreHistoricalImportInBackground(tenant.id);
}

export async function stopAnkorstoreHistoricalImport(): Promise<{ success: true }> {
  await requireAdmin();
  const tenant = await requireCurrentTenant();
  await requestStopAnkorstoreHistoricalImport(tenant.id);
  return { success: true };
}

export async function acknowledgeAnkorstoreHistoricalImport(): Promise<{ success: true }> {
  await requireAdmin();
  const tenant = await requireCurrentTenant();
  await resetAnkorstoreImportState(tenant.id);
  return { success: true };
}

export async function getAnkorstoreImportStateAction(): Promise<AnkorstoreImportState> {
  await requireAdmin();
  const tenant = await requireCurrentTenant();
  return getAnkorstoreImportState(tenant.id);
}

export async function getAnkorstoreOrdersSyncMeta(): Promise<{
  lastSyncedAt: string | null;
  totalOrdersInDb: number;
  hasCredentials: boolean;
}> {
  await requireAdmin();
  const tenant = await requireCurrentTenant();
  const [lastSyncRow, credsRows, totalOrdersInDb] = await Promise.all([
    prisma.siteConfig.findFirst({
      where: { tenantId: tenant.id, key: "ankorstore_orders_last_synced_at" },
      select: { value: true },
    }),
    prisma.siteConfig.findMany({
      where: {
        tenantId: tenant.id,
        key: { in: ["ankors_client_id", "ankors_client_secret"] },
      },
      select: { key: true, value: true },
    }),
    prisma.ankorstoreOrder.count({ where: { tenantId: tenant.id } }),
  ]);
  const credsMap = new Map(credsRows.map((r) => [r.key, r.value]));
  const hasCredentials =
    (credsMap.get("ankors_client_id") || "").trim().length > 0 &&
    (credsMap.get("ankors_client_secret") || "").trim().length > 0;
  const lastSyncedAt = lastSyncRow?.value
    ? new Date(parseInt(lastSyncRow.value, 10)).toISOString()
    : null;
  return { lastSyncedAt, totalOrdersInDb, hasCredentials };
}

// ─────────────────────────────────────────────
// Déduction du stock (preview + run) — commande unique
// ─────────────────────────────────────────────

export type AnkorstoreSingleOrderDeductionPreview = Awaited<
  ReturnType<
    typeof import("@/lib/ankorstore-stock-deduction").simulateAnkorstoreStockDeductionForOrder
  >
>;

export async function previewAnkorstoreOrderStockDeduction(
  orderId: string,
): Promise<
  | { success: true; preview: NonNullable<AnkorstoreSingleOrderDeductionPreview> }
  | { success: false; error: string }
> {
  await requireAdmin();
  const tenant = await requireCurrentTenant();
  try {
    const { simulateAnkorstoreStockDeductionForOrder } = await import(
      "@/lib/ankorstore-stock-deduction"
    );
    const preview = await simulateAnkorstoreStockDeductionForOrder(tenant.id, orderId);
    if (!preview) return { success: false, error: "Commande introuvable." };
    return { success: true, preview };
  } catch (err) {
    logger.error("[Ankorstore Stock] Preview échouée", { error: err as Error });
    return { success: false, error: err instanceof Error ? err.message : "Erreur inconnue" };
  }
}

export async function runAnkorstoreOrderStockDeductionOne(
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
    const { deductStockFromAnkorstoreOrders } = await import(
      "@/lib/ankorstore-stock-deduction"
    );
    const result = await deductStockFromAnkorstoreOrders(tenant.id, session.user.id ?? null, [
      orderId,
    ]);
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
    logger.error("[Ankorstore Stock] Déduction commande unique échouée", { error: err as Error });
    return { success: false, error: err instanceof Error ? err.message : "Erreur inconnue" };
  }
}

export async function listAnkorstoreOrdersForClientCard(
  adminClientCardId: string,
): Promise<AnkorstoreOrderListItem[]> {
  await requireAdmin();
  const tenant = await requireCurrentTenant();
  const rows = await prisma.ankorstoreOrder.findMany({
    where: { tenantId: tenant.id, adminClientCardId },
    orderBy: { createdAtAnkor: "desc" },
    select: {
      id: true,
      ankorstoreOrderId: true,
      reference: true,
      createdAtAnkor: true,
      submittedAt: true,
      shippedAt: true,
      status: true,
      statusRaw: true,
      customerName: true,
      customerShop: true,
      customerCountry: true,
      carrier: true,
      trackingNumber: true,
      trackingStatus: true,
      brandTotalAmount: true,
      brandTotalAmountWithVat: true,
    },
  });
  return rows.map((r) => ({
    id: r.id,
    ankorstoreOrderId: r.ankorstoreOrderId,
    reference: r.reference,
    createdAtAnkor: r.createdAtAnkor.toISOString(),
    submittedAt: r.submittedAt?.toISOString() ?? null,
    shippedAt: r.shippedAt?.toISOString() ?? null,
    status: r.status,
    statusRaw: r.statusRaw,
    customerName: r.customerName,
    customerShop: r.customerShop,
    customerCountry: r.customerCountry,
    carrier: r.carrier,
    trackingNumber: r.trackingNumber,
    trackingStatus: r.trackingStatus,
    totalHT: decimalToNumber(r.brandTotalAmount),
    totalTTC: decimalToNumber(r.brandTotalAmountWithVat),
  }));
}
