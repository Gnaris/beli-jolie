"use server";

import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { syncProductToPfs } from "@/lib/pfs-reverse-sync";

async function requireAdmin() {
  const session = await getServerSession(authOptions);
  if (!session || session.user.role !== "ADMIN") {
    throw new Error("Accès non autorisé.");
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
