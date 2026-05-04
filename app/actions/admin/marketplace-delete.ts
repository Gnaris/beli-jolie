"use server";

import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { pfsDeleteProduct } from "@/lib/pfs-api-write";
import { logger } from "@/lib/logger";

async function requireAdmin() {
  const session = await getServerSession(authOptions);
  if (!session || session.user.role !== "ADMIN") {
    throw new Error("Accès non autorisé.");
  }
}

export interface PfsDeleteOutcome {
  pfsProductId: string;
  reference: string;
  status: "ok" | "error";
  message?: string;
}

/**
 * Soft-delete sur PFS pour une liste de produits (par leur pfsProductId).
 * Utilisé quand l'admin supprime des produits de la boutique et veut
 * aussi les retirer de Paris Fashion Shop.
 */
export async function deleteProductsOnPfs(
  items: { pfsProductId: string; reference: string }[],
): Promise<PfsDeleteOutcome[]> {
  await requireAdmin();
  const results: PfsDeleteOutcome[] = [];
  for (const item of items) {
    try {
      await pfsDeleteProduct(item.pfsProductId);
      results.push({ pfsProductId: item.pfsProductId, reference: item.reference, status: "ok" });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      logger.error("[Marketplace Delete] PFS delete failed", {
        pfsProductId: item.pfsProductId,
        reference: item.reference,
        error: message,
      });
      results.push({
        pfsProductId: item.pfsProductId,
        reference: item.reference,
        status: "error",
        message,
      });
    }
  }
  return results;
}
