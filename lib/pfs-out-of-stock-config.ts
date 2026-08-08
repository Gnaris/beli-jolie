/**
 * Configuration du comportement PFS quand une variante passe à stock 0.
 *
 * 1 seule clé SiteConfig (par tenant) :
 *   - pfs_out_of_stock_deactivate_variant : "true" (défaut) | "false"
 *       "true"  → on envoie is_active=false à PFS quand stock=0 (variante disparaît de la fiche PFS)
 *       "false" → on laisse is_active=true (variante reste visible marquée en rupture)
 *
 * Le statut PRODUIT n'est plus impacté par la rupture depuis 2026-08-07
 * (règle métier : l'admin garde le contrôle du statut).
 */

import { getCachedSiteConfig } from "@/lib/cached-data";

export interface PfsOutOfStockConfig {
  deactivateVariant: boolean;
}

export const PFS_OUT_OF_STOCK_DEFAULTS: PfsOutOfStockConfig = {
  deactivateVariant: true,
};

export function parsePfsDeactivateVariant(raw: string | null | undefined): boolean {
  if (raw === "false") return false;
  if (raw === "true") return true;
  return PFS_OUT_OF_STOCK_DEFAULTS.deactivateVariant;
}

export async function getPfsOutOfStockConfig(): Promise<PfsOutOfStockConfig> {
  const row = await getCachedSiteConfig("pfs_out_of_stock_deactivate_variant");
  return { deactivateVariant: parsePfsDeactivateVariant(row?.value) };
}
