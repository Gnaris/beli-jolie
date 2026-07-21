"use server";

import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { requireCurrentTenant } from "@/lib/tenant";
import { setMarketplaceMaintenance, type MarketplaceKey, MARKETPLACES } from "@/lib/platform-config";
import { revalidatePath } from "next/cache";
import { logger } from "@/lib/logger";

/**
 * Slugs du tenant "maître" de la plateforme — seuls autorisés à basculer les
 * flags maintenance qui s'appliquent à toutes les boutiques.
 * Prod = "beliandjolie", dev-local = "beli-jolie" (seed script d'origine).
 */
const PLATFORM_ADMIN_TENANT_SLUGS = new Set(["beliandjolie", "beli-jolie"]);

async function requirePlatformAdmin() {
  const session = await getServerSession(authOptions);
  if (!session || session.user.role !== "ADMIN") {
    throw new Error("Accès non autorisé.");
  }
  const tenant = await requireCurrentTenant();
  if (!PLATFORM_ADMIN_TENANT_SLUGS.has(tenant.slug)) {
    throw new Error(
      "Réservé à la boutique maîtresse de la plateforme.",
    );
  }
}

export async function toggleMarketplaceMaintenance(
  marketplace: MarketplaceKey,
  active: boolean,
): Promise<{ success: boolean; error?: string }> {
  try {
    await requirePlatformAdmin();
    if (!MARKETPLACES.includes(marketplace)) {
      return { success: false, error: "Marketplace inconnue." };
    }
    await setMarketplaceMaintenance(marketplace, active);
    logger.info("[Platform] Marketplace maintenance toggled", {
      marketplace,
      active,
    });
    revalidatePath("/admin/plateforme");
    // Force le rendu des badges produits (partout).
    revalidatePath("/admin/produits");
    return { success: true };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { success: false, error: message };
  }
}
