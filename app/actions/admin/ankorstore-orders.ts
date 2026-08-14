"use server";

import { getServerSession } from "next-auth";
import { revalidatePath } from "next/cache";
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
  syncSingleAnkorstoreOrder,
} from "@/lib/ankorstore-orders-sync";

async function requireAdmin() {
  const session = await getServerSession(authOptions);
  if (!session || session.user.role !== "ADMIN") {
    throw new Error("Accès non autorisé.");
  }
  return session;
}

function decimalToNumber(d: Prisma.Decimal | number | null | undefined): number {
  if (d == null) return 0;
  if (typeof d === "number") return d;
  return Number(d.toString());
}

// ─────────────────────────────────────────────
// Sync manuelle + import historique
// ─────────────────────────────────────────────

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
    logger.error("[Ankorstore Orders] syncAnkorstoreOrdersNow échec", {
      error: err as Error,
    });
    return {
      success: false,
      error: err instanceof Error ? err.message : "Erreur inconnue",
    };
  } finally {
    if (tenantIdForMark) {
      await prisma.siteConfig
        .upsert({
          where: {
            tenantId_key: {
              tenantId: tenantIdForMark,
              key: "ankorstore_orders_last_synced_at",
            },
          },
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
    const res = await syncSingleAnkorstoreOrder(tenant.id, row.ankorstoreOrderId);
    if (!res) return { success: false, error: "Commande absente côté Ankorstore (404)." };
    revalidatePath("/admin/commandes");
    return { success: true };
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : "Erreur inconnue",
    };
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

// Compat : ancien nom du stub, gardé pour ne pas casser d'éventuels callers résiduels.
export async function triggerAnkorstoreOrdersImport(): Promise<
  | { success: true; state: AnkorstoreImportState }
  | { success: false; error: string }
> {
  try {
    const state = await startAnkorstoreHistoricalImport();
    return { success: true, state };
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : "Erreur inconnue",
    };
  }
}

// ─────────────────────────────────────────────
// Détail pour le drawer
// ─────────────────────────────────────────────

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

  customerName: string;
  customerShop: string | null;
  customerEmail: string | null;
  customerPhone: string | null;
  customerVatNumber: string | null;
  customerSiret: string | null;
  customerCountry: string | null;
  adminClientCardId: string | null;

  shippingMethod: string | null;
  carrier: string | null;
  trackingNumber: string | null;
  trackingLink: string | null;
  trackingStatus: string | null;

  shippingAddress: {
    name: string | null;
    company: string | null;
    street: string | null;
    postalCode: string | null;
    city: string | null;
    country: string | null;
  } | null;
  billingAddress: {
    name: string | null;
    company: string | null;
    street: string | null;
    postalCode: string | null;
    city: string | null;
    country: string | null;
  } | null;

  items: AnkorstoreOrderItemDetail[];
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

  const shippingAddress =
    row.shippingName || row.shippingStreet || row.shippingOrganisationName
      ? {
          name: row.shippingName,
          company: row.shippingOrganisationName,
          street: row.shippingStreet,
          postalCode: row.shippingPostalCode,
          city: row.shippingCity,
          country: row.shippingCountryCode,
        }
      : null;

  const billingAddress =
    row.billingName || row.billingStreet || row.billingOrganisationName
      ? {
          name: row.billingName,
          company: row.billingOrganisationName,
          street: row.billingStreet,
          postalCode: row.billingPostalCode,
          city: row.billingCity,
          country: row.billingCountryCode,
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

    customerName: row.customerName,
    customerShop: row.customerShop,
    customerEmail: row.customerEmail,
    customerPhone: row.customerPhone,
    customerVatNumber: row.customerVatNumber,
    customerSiret: row.customerSiret,
    customerCountry: row.customerCountry,
    adminClientCardId: row.adminClientCardId,

    shippingMethod: row.shippingMethod,
    carrier: row.carrier,
    trackingNumber: row.trackingNumber,
    trackingLink: row.trackingLink,
    trackingStatus: row.trackingStatus,

    shippingAddress,
    billingAddress,

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
  };
}
