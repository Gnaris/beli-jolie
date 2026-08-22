"use server";

import { getServerSession } from "next-auth";
import { revalidatePath, revalidateTag } from "next/cache";
import { authOptions } from "@/lib/auth";
import { requireCurrentTenant } from "@/lib/tenant";
import { logger } from "@/lib/logger";
import {
  countPendingPfsStockDeductions,
  deductStockFromPfsOrders,
  simulatePfsStockDeductionAll,
  type PfsStockDeductionResult,
  type PfsStockPreviewAll,
} from "@/lib/pfs-stock-deduction";
import { prisma } from "@/lib/prisma";
import { pickFirstImage } from "@/lib/pick-first-image";

async function requireAdmin() {
  const session = await getServerSession(authOptions);
  if (!session || session.user.role !== "ADMIN") {
    throw new Error("Accès non autorisé.");
  }
  return session;
}

/**
 * Payload sérialisé décrivant un produit touché par la déduction, calibré
 * pour être passé tel quel au hook `useRefreshMarketplaceDialog().refreshBulk`
 * (les champs correspondent au type `RefreshableProduct`).
 */
export interface PfsStockDeductionRefreshPayload {
  productId: string;
  reference: string;
  productName: string;
  firstImage: string | null;
  status: "ONLINE" | "OFFLINE" | "ARCHIVED" | "SYNCING";
  isIncomplete: boolean;
  wasImported: boolean;
  locked: boolean;
  /** ID Orderchamp — présent = fiche déjà côté OC (refresh via republish),
   *  absent = enqueue en mode "publish" pour créer la fiche. */
  orderchampProductId: string | null;
}

export type PfsStockDeductionActionResult =
  | {
      success: true;
      result: PfsStockDeductionResult;
      refreshPayloads: PfsStockDeductionRefreshPayload[];
    }
  | { success: false; error: string };

export async function getPendingPfsStockDeductionCount(): Promise<number> {
  await requireAdmin();
  const tenant = await requireCurrentTenant();
  return countPendingPfsStockDeductions(tenant.id);
}

export type PfsStockDeductionPreviewResult =
  | { success: true; preview: PfsStockPreviewAll }
  | { success: false; error: string };

/**
 * Simule la déduction pour l'ensemble des lignes PFS en attente. Utilisée par
 * la modale « Prévisualisation avant déduction » : renvoie la vue agrégée par
 * produit avec image, stock actuel → nouveau stock, commandes source.
 */
export async function getPfsStockDeductionPreview(): Promise<PfsStockDeductionPreviewResult> {
  await requireAdmin();
  const tenant = await requireCurrentTenant();
  try {
    const preview = await simulatePfsStockDeductionAll(tenant.id);
    return { success: true, preview };
  } catch (err) {
    logger.error("[PFS Stock] Preview globale échouée", { error: err });
    return { success: false, error: err instanceof Error ? err.message : "Erreur inconnue" };
  }
}

export interface RunPfsStockDeductionInput {
  /**
   * IDs des produits que l'admin a choisi d'exclure depuis la modale de
   * prévisualisation. Les lignes PFS concernées sont marquées
   * `stockDeductionExcludedAt` sans jamais modifier le stock. Action définitive.
   */
  excludedProductIds?: string[];
}

export async function runPfsStockDeduction(
  input?: RunPfsStockDeductionInput,
): Promise<PfsStockDeductionActionResult> {
  const session = await requireAdmin();
  const tenant = await requireCurrentTenant();

  try {
    const result = await deductStockFromPfsOrders(tenant.id, session.user.id ?? null, {
      excludedProductIds: input?.excludedProductIds ?? [],
    });

    if (result.touchedProductIds.length > 0) {
      revalidateTag("products", "default");
      revalidateTag("dashboard-stats", "default");
      revalidatePath("/admin/produits");
    }

    const refreshPayloads = await buildRefreshPayloads(tenant.id, result.touchedProductIds);

    return { success: true, result, refreshPayloads };
  } catch (err) {
    logger.error("[PFS Stock] Déduction échouée", { error: err });
    return { success: false, error: err instanceof Error ? err.message : "Erreur inconnue" };
  }
}

async function buildRefreshPayloads(
  tenantId: string,
  productIds: string[],
): Promise<PfsStockDeductionRefreshPayload[]> {
  if (productIds.length === 0) return [];

  const products = await prisma.product.findMany({
    where: { tenantId, id: { in: productIds } },
    select: {
      id: true,
      reference: true,
      name: true,
      status: true,
      isIncomplete: true,
      locked: true,
      pfsProductId: true,
      orderchampProductId: true,
      primaryColorId: true,
      colors: {
        orderBy: [{ isPrimary: "desc" }, { createdAt: "asc" }],
        select: { colorId: true },
      },
    },
  });

  const images = await prisma.productColorImage.findMany({
    where: { productId: { in: productIds } },
    orderBy: { order: "asc" },
    select: { productId: true, colorId: true, path: true },
  });
  const imagesByKey = new Map<string, string>();
  for (const img of images) {
    const key = `${img.productId}::${img.colorId}`;
    if (!imagesByKey.has(key)) imagesByKey.set(key, img.path);
  }

  return products.map((p) => ({
    productId: p.id,
    reference: p.reference,
    productName: p.name,
    firstImage: pickFirstImage(
      { primaryColorId: p.primaryColorId, colors: p.colors },
      (colorId) => (colorId ? imagesByKey.get(`${p.id}::${colorId}`) ?? null : null),
    ),
    status: p.status as "ONLINE" | "OFFLINE" | "ARCHIVED" | "SYNCING",
    isIncomplete: p.isIncomplete,
    wasImported: !!p.pfsProductId,
    locked: p.locked,
    orderchampProductId: p.orderchampProductId,
  }));
}
