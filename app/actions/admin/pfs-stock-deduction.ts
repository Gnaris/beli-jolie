"use server";

import { getServerSession } from "next-auth";
import { revalidatePath, revalidateTag } from "next/cache";
import { authOptions } from "@/lib/auth";
import { requireCurrentTenant } from "@/lib/tenant";
import { logger } from "@/lib/logger";
import {
  countPendingPfsStockDeductions,
  deductStockFromPfsOrders,
  type PfsStockDeductionResult,
} from "@/lib/pfs-stock-deduction";
import { prisma } from "@/lib/prisma";

async function requireAdmin() {
  const session = await getServerSession(authOptions);
  if (!session || session.user.role !== "ADMIN") {
    throw new Error("Accès non autorisé.");
  }
  return session;
}

export type PfsStockDeductionActionResult =
  | { success: true; result: PfsStockDeductionResult }
  | { success: false; error: string };

export async function getPendingPfsStockDeductionCount(): Promise<number> {
  await requireAdmin();
  const tenant = await requireCurrentTenant();
  return countPendingPfsStockDeductions(tenant.id);
}

export async function runPfsStockDeduction(): Promise<PfsStockDeductionActionResult> {
  const session = await requireAdmin();
  const tenant = await requireCurrentTenant();

  try {
    const result = await deductStockFromPfsOrders(tenant.id, session.user.id ?? null);

    if (result.touchedProductIds.length > 0) {
      revalidateTag("products", "default");
      revalidateTag("dashboard-stats", "default");
      revalidatePath("/admin/produits");
    }

    return { success: true, result };
  } catch (err) {
    logger.error("[PFS Stock] Déduction échouée", { error: err });
    return { success: false, error: err instanceof Error ? err.message : "Erreur inconnue" };
  }
}

export type PfsStockPostDeductionMarketplace = "SHOP" | "ANKORSTORE" | "EFASHION" | "FAIRE";

export interface PfsStockPostDeductionActionInput {
  productIds: string[];
  marketplaces: PfsStockPostDeductionMarketplace[];
}

export type PfsStockPostDeductionActionResult =
  | { success: true; taggedCount: number }
  | { success: false; error: string };

/**
 * Après une déduction, marque les produits touchés comme « synchro nécessaire »
 * sur les marketplaces sélectionnées. PFS est volontairement exclu (PFS gère
 * son propre stock côté leur plateforme après validation de commande).
 *
 * Pour un push immédiat, le client appellera séparément le hook
 * `useRefreshMarketplaceDialog` sur la liste des productIds.
 */
export async function markProductsSyncRequiredAfterDeduction(
  input: PfsStockPostDeductionActionInput,
): Promise<PfsStockPostDeductionActionResult> {
  await requireAdmin();
  const tenant = await requireCurrentTenant();

  const productIds = Array.from(new Set(input.productIds)).filter(Boolean);
  const marketplaces = Array.from(new Set(input.marketplaces)).filter(
    (m): m is PfsStockPostDeductionMarketplace => m === "SHOP" || m === "ANKORSTORE" || m === "EFASHION" || m === "FAIRE",
  );

  if (productIds.length === 0 || marketplaces.length === 0) {
    return { success: true, taggedCount: 0 };
  }

  try {
    const data: {
      ankorsSyncRequired?: boolean;
      efashionSyncRequired?: boolean;
      faireSyncRequired?: boolean;
      lastRefreshedAt?: Date;
    } = {};
    if (marketplaces.includes("ANKORSTORE")) data.ankorsSyncRequired = true;
    if (marketplaces.includes("EFASHION")) data.efashionSyncRequired = true;
    if (marketplaces.includes("FAIRE")) data.faireSyncRequired = true;
    if (marketplaces.includes("SHOP")) data.lastRefreshedAt = new Date();

    const touched = await prisma.product.updateMany({
      where: { tenantId: tenant.id, id: { in: productIds } },
      data,
    });
    revalidateTag("products", "default");
    revalidatePath("/admin/produits");
    return { success: true, taggedCount: touched.count };
  } catch (err) {
    logger.error("[PFS Stock] Post-déduction marketplace échouée", { error: err });
    return { success: false, error: err instanceof Error ? err.message : "Erreur inconnue" };
  }
}
