/**
 * Configuration du comportement PFS quand une variante — ou toutes les variantes
 * d'un produit — passe(nt) à stock 0.
 *
 * 2 clés SiteConfig (par tenant) :
 *   - pfs_out_of_stock_deactivate_variant : "true" (défaut) | "false"
 *       "true"  → on envoie is_active=false à PFS quand stock=0 (variante disparaît de la fiche PFS)
 *       "false" → on laisse is_active=true (variante reste visible marquée en rupture)
 *
 *   - pfs_out_of_stock_product_action : "archived" (défaut) | "deleted" | "draft"
 *       action à appliquer sur le produit PFS quand toutes ses variantes sont
 *       en rupture, remplaçant le mapping local → PFS habituel.
 */

import { getCachedSiteConfig } from "@/lib/cached-data";

export type PfsOutOfStockProductAction = "archived" | "deleted" | "draft";

export interface PfsOutOfStockConfig {
  deactivateVariant: boolean;
  productAction: PfsOutOfStockProductAction;
}

export const PFS_OUT_OF_STOCK_DEFAULTS: PfsOutOfStockConfig = {
  deactivateVariant: true,
  productAction: "archived",
};

export function parsePfsOutOfStockProductAction(
  raw: string | null | undefined,
): PfsOutOfStockProductAction {
  if (raw === "deleted" || raw === "draft" || raw === "archived") return raw;
  return PFS_OUT_OF_STOCK_DEFAULTS.productAction;
}

export function parsePfsDeactivateVariant(raw: string | null | undefined): boolean {
  if (raw === "false") return false;
  if (raw === "true") return true;
  return PFS_OUT_OF_STOCK_DEFAULTS.deactivateVariant;
}

export async function getPfsOutOfStockConfig(): Promise<PfsOutOfStockConfig> {
  const [deacRow, actionRow] = await Promise.all([
    getCachedSiteConfig("pfs_out_of_stock_deactivate_variant"),
    getCachedSiteConfig("pfs_out_of_stock_product_action"),
  ]);
  return {
    deactivateVariant: parsePfsDeactivateVariant(deacRow?.value),
    productAction: parsePfsOutOfStockProductAction(actionRow?.value),
  };
}
