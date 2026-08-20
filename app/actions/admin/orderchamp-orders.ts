"use server";

/**
 * Server actions — gestion des commandes Orderchamp (sync manuelle, import
 * historique, déduction stock). Miroir de `app/actions/admin/faire-orders.ts`.
 *
 * Toutes les actions ici sont protégées par `requireAdmin()`. Retour standard
 * `{ success: boolean, error?: string }` sauf lecture d'état.
 */

import { getServerSession } from "next-auth";
import { revalidatePath, revalidateTag } from "next/cache";
import { authOptions } from "@/lib/auth";
import { tenantALS } from "@/lib/tenant-als";
import { requireCurrentTenant } from "@/lib/tenant";
import { syncRecentOrderchampOrders } from "@/lib/orderchamp-orders-sync";
import {
  countPendingOrderchampStockDeductions,
  deductStockFromOrderchampOrders,
} from "@/lib/orderchamp-stock-deduction";
import {
  getOrderchampImportState,
  requestStopOrderchampImport,
  startOrderchampHistoricalImport,
  type OrderchampImportState,
} from "@/lib/orderchamp-orders-import-state";

async function requireAdmin() {
  const session = await getServerSession(authOptions);
  if (!session || session.user.role !== "ADMIN") {
    throw new Error("Accès non autorisé.");
  }
  return session;
}

// ─────────────────────────────────────────────
// Sync manuelle
// ─────────────────────────────────────────────

export async function syncOrderchampOrdersNow(): Promise<{
  success: boolean;
  created?: number;
  updated?: number;
  scanned?: number;
  error?: string;
}> {
  await requireAdmin();
  const tenant = await requireCurrentTenant();
  try {
    const res = await tenantALS.run(tenant.id, async () => {
      return syncRecentOrderchampOrders(tenant.id);
    });
    revalidatePath("/admin/commandes");
    revalidateTag("orderchamp-orders", "default");
    return { success: true, ...res };
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : "Erreur inconnue.",
    };
  }
}

// ─────────────────────────────────────────────
// Import historique
// ─────────────────────────────────────────────

export async function startOrderchampHistoricalImportAction(): Promise<{
  success: boolean;
  started?: boolean;
  reason?: string;
  error?: string;
}> {
  await requireAdmin();
  const tenant = await requireCurrentTenant();
  try {
    const res = await startOrderchampHistoricalImport(tenant.id);
    return { success: true, started: res.started, reason: res.reason };
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : "Erreur inconnue.",
    };
  }
}

export async function stopOrderchampHistoricalImportAction(): Promise<{
  success: boolean;
  error?: string;
}> {
  await requireAdmin();
  const tenant = await requireCurrentTenant();
  try {
    await requestStopOrderchampImport(tenant.id);
    return { success: true };
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : "Erreur inconnue.",
    };
  }
}

export async function getOrderchampImportStateAction(): Promise<OrderchampImportState> {
  await requireAdmin();
  const tenant = await requireCurrentTenant();
  return getOrderchampImportState(tenant.id);
}

// ─────────────────────────────────────────────
// Déduction stock
// ─────────────────────────────────────────────

export async function previewOrderchampStockDeduction(): Promise<{
  success: boolean;
  pendingCount?: number;
  error?: string;
}> {
  await requireAdmin();
  const tenant = await requireCurrentTenant();
  try {
    const pendingCount = await countPendingOrderchampStockDeductions(tenant.id);
    return { success: true, pendingCount };
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : "Erreur inconnue.",
    };
  }
}

export async function runOrderchampStockDeduction(
  orderchampOrderIds?: string[],
): Promise<{
  success: boolean;
  processed?: number;
  skipped?: number;
  error?: string;
}> {
  const session = await requireAdmin();
  const tenant = await requireCurrentTenant();
  try {
    const result = await deductStockFromOrderchampOrders(
      tenant.id,
      session.user.id ?? null,
      orderchampOrderIds,
    );
    revalidatePath("/admin/produits");
    revalidatePath("/admin/commandes");
    revalidateTag("products", "default");
    return {
      success: true,
      processed: result.processedCount,
      skipped: result.skipped.length,
    };
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : "Erreur inconnue.",
    };
  }
}
