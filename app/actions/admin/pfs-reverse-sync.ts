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
): Promise<{ success: boolean; error?: string }> {
  await requireAdmin();

  try {
    await syncProductToPfs(productId);
    return { success: true };
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}
