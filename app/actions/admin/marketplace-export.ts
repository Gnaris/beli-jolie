"use server";

import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { previewMarketplaceExport } from "@/lib/marketplace-excel/export-orchestrator";
import type { MarketplaceKey } from "@/lib/marketplace-excel/types";

async function requireAdmin() {
  const session = await getServerSession(authOptions);
  if (!session || session.user.role !== "ADMIN") {
    throw new Error("Accès non autorisé.");
  }
}

export interface PreviewMarketplaceExportResult {
  success: true;
  marketplace: MarketplaceKey;
  marketplaceLabel: string;
  eligible: Array<{ productId: string; reference: string }>;
  ignored: Array<{ productId: string; reference: string; missing: string[] }>;
}

export interface PreviewMarketplaceExportError {
  success: false;
  error: string;
}

/**
 * Preview-only step : runs the validators and returns the list of eligible
 * vs ignored products. The UI shows this and asks the admin to confirm before
 * triggering the actual ZIP download.
 */
export async function previewMarketplaceExportAction(
  marketplace: MarketplaceKey,
  productIds: string[],
): Promise<PreviewMarketplaceExportResult | PreviewMarketplaceExportError> {
  try {
    await requireAdmin();
    if (productIds.length === 0) {
      return { success: false, error: "Aucun produit sélectionné." };
    }

    const preview = await previewMarketplaceExport(marketplace, productIds);

    return {
      success: true,
      marketplace: preview.marketplace,
      marketplaceLabel: preview.marketplaceLabel,
      eligible: preview.eligible.map((e) => ({
        productId: e.productId,
        reference: e.reference,
      })),
      ignored: preview.ignored.map((e) => ({
        productId: e.productId,
        reference: e.reference,
        missing: e.missing,
      })),
    };
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : "Erreur inconnue",
    };
  }
}
