"use server";

import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { syncProductToPfs } from "@/lib/pfs-reverse-sync";
import { pfsCheckReference } from "@/lib/pfs-api";
import { prisma } from "@/lib/prisma";
import { logger } from "@/lib/logger";

async function requireAdmin() {
  const session = await getServerSession(authOptions);
  if (!session || session.user.role !== "ADMIN") {
    throw new Error("Accès non autorisé.");
  }
}

/**
 * Check if a product reference exists on PFS.
 * If not found, clears stale DB state and returns exists=false.
 */
export async function checkPfsProductExists(
  productId: string,
): Promise<{ exists: boolean; error?: string }> {
  await requireAdmin();

  try {
    const product = await prisma.product.findUnique({
      where: { id: productId },
      select: { reference: true },
    });
    if (!product) return { exists: false, error: "Produit introuvable" };

    const refCheck = await pfsCheckReference(product.reference);
    logger.info(`[PFS] checkPfsProductExists for ${product.reference}`, { exists: refCheck?.exists });

    if (refCheck?.exists && refCheck?.product?.id) {
      return { exists: true };
    }

    // Not found — clear stale DB state
    await prisma.product.update({
      where: { id: productId },
      data: { pfsSyncStatus: null, pfsProductId: null, pfsSyncError: null },
    });

    return { exists: false };
  } catch (err) {
    return { exists: false, error: err instanceof Error ? err.message : String(err) };
  }
}

/**
 * Force sync a product to PFS. Called from the admin UI.
 * Returns { success, error? } — does NOT throw (for UI consumption).
 */
export async function forcePfsSync(
  productId: string,
  { forceCreate = false }: { forceCreate?: boolean } = {},
): Promise<{ success: boolean; error?: string }> {
  await requireAdmin();

  const { logger } = await import("@/lib/logger");
  logger.info(`[PFS forcePfsSync] Called for ${productId}, forceCreate=${forceCreate}`);

  try {
    await syncProductToPfs(productId, { forceCreate });
    logger.info(`[PFS forcePfsSync] SUCCESS for ${productId}`);
    return { success: true };
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    logger.info(`[PFS forcePfsSync] FAILED for ${productId}: ${errorMsg}`);
    return {
      success: false,
      error: errorMsg,
    };
  }
}
