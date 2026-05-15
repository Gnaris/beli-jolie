/**
 * Détermine les produits éligibles à une propagation marketplace après une
 * modification en masse de variantes depuis la table /admin/produits.
 *
 * Un produit est éligible à PFS si :
 *   - PFS est configuré côté admin
 *   - Le produit est déjà publié (pfsProductId connu)
 *
 * Un produit est éligible à Ankorstore si :
 *   - Ankorstore est configuré ET activé (kill switch)
 *   - Le produit est déjà publié (ankorsProductId connu)
 */

export interface BulkVariantProduct {
  id: string;
  pfsProductId: string | null;
  ankorsProductId: string | null;
  colors: { id: string }[];
}

export interface BulkVariantMarketplaceTargets<P extends BulkVariantProduct> {
  affectedProducts: P[];
  pfsProducts: P[];
  ankorsProducts: P[];
}

export function computeBulkVariantMarketplaceTargets<P extends BulkVariantProduct>(
  allProducts: readonly P[],
  selectedVariantIds: readonly string[],
  flags: { hasPfsConfig: boolean; showAnkorstore: boolean },
): BulkVariantMarketplaceTargets<P> {
  const affectedProductIds = new Set<string>();
  for (const variantId of selectedVariantIds) {
    const product = allProducts.find((p) => p.colors.some((c) => c.id === variantId));
    if (product) affectedProductIds.add(product.id);
  }
  const affectedProducts = allProducts.filter((p) => affectedProductIds.has(p.id));
  const pfsProducts = flags.hasPfsConfig
    ? affectedProducts.filter((p) => !!p.pfsProductId)
    : [];
  const ankorsProducts = flags.showAnkorstore
    ? affectedProducts.filter((p) => !!p.ankorsProductId)
    : [];
  return { affectedProducts, pfsProducts, ankorsProducts };
}
