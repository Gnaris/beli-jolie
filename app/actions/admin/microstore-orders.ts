"use server";

/**
 * Server actions Microstore Orders — lecture + import.
 *
 * Ces actions s'appellent depuis la page /admin/commandes/microstore.
 */

import { revalidatePath, revalidateTag } from "next/cache";
import { requireAdmin } from "@/lib/auth-helpers";
import { prisma } from "@/lib/prisma";
import { logger } from "@/lib/logger";
import {
  syncMicrostoreOrders,
  type MicrostoreSyncResult,
} from "@/lib/microstore-orders-sync";
import { MicrostoreSessionExpiredError } from "@/lib/microstore-client";
import { setSiteConfig } from "@/lib/site-config-write";
import {
  getMicrostoreImportState,
  startMicrostoreHistoricalImportInBackground,
  requestStopMicrostoreHistoricalImport,
  resetMicrostoreImportState,
  type MicrostoreImportState,
} from "@/lib/microstore-orders-import-state";

export type { MicrostoreImportState, MicrostoreImportRecentEvent } from "@/lib/microstore-orders-import-state";

/**
 * Lance un import Microstore synchrone sur une plage de dates.
 * Retourne le résumé pour affichage dans un toast/notification.
 *
 * NB : sync (bloquant). Pour l'instant on fait simple : la page affiche un
 * spinner pendant l'import. Sur les gros catalogues, on passera à un job
 * background (comme faire-orders-worker).
 */
export async function importMicrostoreOrders(input: {
  fromDate: string;
  toDate: string;
}): Promise<{
  success: boolean;
  result?: MicrostoreSyncResult;
  error?: string;
  sessionExpired?: boolean;
}> {
  try {
    const { tenant } = await requireAdmin();
    if (!isYmd(input.fromDate) || !isYmd(input.toDate)) {
      return { success: false, error: "Dates invalides (format YYYY-MM-DD attendu)." };
    }
    const result = await syncMicrostoreOrders({
      tenantId: tenant.id,
      fromDate: input.fromDate,
      toDate: input.toDate,
    });
    revalidatePath("/admin/commandes/microstore");
    revalidateTag(`microstore-orders:${tenant.id}`, "default");
    return { success: true, result };
  } catch (err) {
    if (err instanceof MicrostoreSessionExpiredError) {
      return { success: false, sessionExpired: true, error: err.message };
    }
    logger.error("[Microstore] import failed", { error: err });
    return {
      success: false,
      error: err instanceof Error ? err.message : "Erreur inconnue.",
    };
  }
}

function isYmd(s: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(s);
}

/**
 * Sync incrémentale pour le bouton "Synchro" de la vue marketplaces.
 * Prend automatiquement la plage `[last_sync-3d ; today]` pour rattraper
 * les statuts qui ont pu changer sans créer de nouvelle commande.
 * Persiste `microstore_orders_last_synced_at` (timestamp ms) à la fin.
 */
export async function syncMicrostoreOrdersNow(): Promise<{
  success: boolean;
  created?: number;
  updated?: number;
  errors?: number;
  error?: string;
  sessionExpired?: boolean;
}> {
  try {
    const { tenant } = await requireAdmin();
    const lastSyncRow = await prisma.siteConfig.findFirst({
      where: { tenantId: tenant.id, key: "microstore_orders_last_synced_at" },
      select: { value: true },
    });
    const lastSyncMs = lastSyncRow?.value ? Number(lastSyncRow.value) : 0;
    const from = lastSyncMs
      ? new Date(lastSyncMs - 3 * 86400_000)
      : new Date(Date.now() - 30 * 86400_000);
    const fromDate = from.toISOString().substring(0, 10);
    const toDate = new Date().toISOString().substring(0, 10);

    const result = await syncMicrostoreOrders({
      tenantId: tenant.id,
      fromDate,
      toDate,
    });
    await setSiteConfig("microstore_orders_last_synced_at", String(Date.now()));
    revalidatePath("/admin/commandes");
    revalidatePath("/admin/commandes/microstore");
    revalidateTag(`microstore-orders:${tenant.id}`, "default");
    return {
      success: true,
      created: result.created,
      updated: result.updated,
      errors: result.errors.length,
    };
  } catch (err) {
    if (err instanceof MicrostoreSessionExpiredError) {
      return { success: false, sessionExpired: true, error: err.message };
    }
    logger.error("[Microstore] syncNow failed", { error: err });
    return { success: false, error: err instanceof Error ? err.message : "Erreur inconnue." };
  }
}

/**
 * Rattrapage complet Microstore — background (fire-and-forget).
 * Retourne l'état d'import initial ; le widget flottant poll ensuite l'état
 * via getMicrostoreImportStateAction().
 *
 * Idempotent : si un rattrapage est déjà RUNNING, renvoie l'état actuel.
 */
export async function startMicrostoreHistoricalImport(): Promise<MicrostoreImportState> {
  const { tenant } = await requireAdmin();
  return startMicrostoreHistoricalImportInBackground(tenant.id);
}

export async function stopMicrostoreHistoricalImport(): Promise<{ success: true }> {
  const { tenant } = await requireAdmin();
  await requestStopMicrostoreHistoricalImport(tenant.id);
  return { success: true };
}

export async function acknowledgeMicrostoreHistoricalImport(): Promise<{ success: true }> {
  const { tenant } = await requireAdmin();
  await resetMicrostoreImportState(tenant.id);
  return { success: true };
}

export async function getMicrostoreImportStateAction(): Promise<MicrostoreImportState> {
  const { tenant } = await requireAdmin();
  return getMicrostoreImportState(tenant.id);
}

/**
 * Renvoie le détail complet d'une commande Microstore importée (avec items et
 * payload brut), pour le drawer côté vue unifiée.
 */
export async function getMicrostoreOrderDetail(orderId: string): Promise<null | {
  id: string;
  microstoreOrderId: string;
  status: string;
  totalHT: number;
  paidPrice: number;
  shippingPrice: number;
  shippingLabel: string | null;
  remark: string | null;
  createdAtMicrostore: string;
  updatedAtMicrostore: string | null;
  shippedAt: string | null;
  customer: {
    name: string;
    company: string | null;
    email: string | null;
    phone: string | null;
    vatNumber: string | null;
  };
  shipping: {
    name: string | null;
    company: string | null;
    street: string | null;
    postalCode: string | null;
    city: string | null;
    countryCode: string | null;
    phone: string | null;
  };
  items: Array<{
    id: string;
    itemRef: string;
    goodsSn: string | null;
    productSnapshotName: string | null;
    colorNameSnapshot: string | null;
    sizeNameSnapshot: string | null;
    quantity: number;
    unitPriceHT: number;
    totalPriceHT: number;
    imageUrl: string | null;
    productId: string | null;
    productColorId: string | null;
    matchedProductName: string | null;
  }>;
}> {
  const { tenant } = await requireAdmin();
  const row = await prisma.microstoreOrder.findFirst({
    where: { id: orderId, tenantId: tenant.id },
    include: {
      items: {
        orderBy: { createdAt: "asc" },
        include: {
          product: { select: { id: true, name: true } },
        },
      },
    },
  });
  if (!row) return null;
  return {
    id: row.id,
    microstoreOrderId: row.microstoreOrderId,
    status: row.status,
    totalHT: Number(row.totalHT),
    paidPrice: Number(row.paidPrice),
    shippingPrice: Number(row.shippingPrice),
    shippingLabel: row.shippingLabel,
    remark: row.remark,
    createdAtMicrostore: row.createdAtMicrostore.toISOString(),
    updatedAtMicrostore: row.updatedAtMicrostore?.toISOString() ?? null,
    shippedAt: row.shippedAt?.toISOString() ?? null,
    customer: {
      name: row.customerName,
      company: row.customerCompany,
      email: row.customerEmail,
      phone: row.customerPhone,
      vatNumber: row.customerVatNumber,
    },
    shipping: {
      name: row.shippingName,
      company: row.shippingCompany,
      street: row.shippingStreet,
      postalCode: row.shippingPostalCode,
      city: row.shippingCity,
      countryCode: row.shippingCountryCode,
      phone: row.shippingPhone,
    },
    items: row.items.map((it) => ({
      id: it.id,
      itemRef: it.itemRef,
      goodsSn: it.goodsSn,
      productSnapshotName: it.productSnapshotName,
      colorNameSnapshot: it.colorNameSnapshot,
      sizeNameSnapshot: it.sizeNameSnapshot,
      quantity: it.quantity,
      unitPriceHT: Number(it.unitPriceHT),
      totalPriceHT: Number(it.totalPriceHT),
      imageUrl: it.imageUrl,
      productId: it.productId,
      productColorId: it.productColorId,
      matchedProductName: it.product?.name ?? null,
    })),
  };
}
export type MicrostoreOrderDetailFull = NonNullable<
  Awaited<ReturnType<typeof getMicrostoreOrderDetail>>
>;

/**
 * Renvoie la date de la commande Microstore la plus récente déjà importée
 * pour ce tenant, ou null. Utilisé par l'UI pour proposer une plage par
 * défaut « depuis la dernière import ».
 */
export async function getMicrostoreLastImportedDate(): Promise<string | null> {
  const { tenant } = await requireAdmin();
  const row = await prisma.microstoreOrder.findFirst({
    where: { tenantId: tenant.id },
    orderBy: { createdAtMicrostore: "desc" },
    select: { createdAtMicrostore: true },
  });
  if (!row) return null;
  return row.createdAtMicrostore.toISOString().substring(0, 10);
}
