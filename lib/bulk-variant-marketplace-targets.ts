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
 *
 * Un produit est éligible à eFashion Paris si :
 *   - eFashion est configuré ET activé (kill switch)
 *   - Au moins une de ses couleurs est liée à un produit eFashion
 *     (efashionProductId non nul)
 *
 * Un produit est éligible à Faire si :
 *   - Faire est configuré ET activé (kill switch)
 *   - Le produit est déjà publié (faireProductId connu)
 *
 * Un produit est éligible à Orderchamp si :
 *   - Orderchamp est configuré ET activé (kill switch)
 *   - Le produit est complet ET son toggle `orderchampEnabled` est ON.
 *   Contrairement aux 4 autres, PAS de contrainte « déjà publié » — OC est
 *   upsert-style (`orderchampUpdateProduct` retombe sur publish si pas de
 *   `orderchampProductId`), donc un premier push peut créer la fiche OC.
 */

import { isOrderchampPropagationEligible } from "@/lib/orderchamp-propagation-eligibility";

export interface BulkVariantProduct {
  id: string;
  pfsProductId: string | null;
  ankorsProductId: string | null;
  faireProductId?: string | null;
  orderchampProductId?: string | null;
  orderchampEnabled?: boolean;
  isIncomplete?: boolean;
  colors: { id: string; efashionProductId?: number | null }[];
}

export interface BulkVariantMarketplaceTargets<P extends BulkVariantProduct> {
  affectedProducts: P[];
  pfsProducts: P[];
  ankorsProducts: P[];
  efashionProducts: P[];
  faireProducts: P[];
  orderchampProducts: P[];
}

export function computeBulkVariantMarketplaceTargets<P extends BulkVariantProduct>(
  allProducts: readonly P[],
  selectedVariantIds: readonly string[],
  flags: {
    hasPfsConfig: boolean;
    showAnkorstore: boolean;
    showEfashion?: boolean;
    showFaire?: boolean;
    showOrderchamp?: boolean;
  },
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
  const efashionProducts = flags.showEfashion
    ? affectedProducts.filter((p) => p.colors.some((c) => c.efashionProductId != null))
    : [];
  const faireProducts = flags.showFaire
    ? affectedProducts.filter((p) => !!p.faireProductId)
    : [];
  const orderchampProducts = flags.showOrderchamp
    ? affectedProducts.filter((p) =>
        isOrderchampPropagationEligible({
          orderchampEnabled: p.orderchampEnabled,
          isIncomplete: !!p.isIncomplete,
        }),
      )
    : [];
  return {
    affectedProducts,
    pfsProducts,
    ankorsProducts,
    efashionProducts,
    faireProducts,
    orderchampProducts,
  };
}
