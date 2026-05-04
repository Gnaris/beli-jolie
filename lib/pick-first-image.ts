/**
 * Choisit l'image principale à afficher dans la liste admin des produits.
 *
 * L'image étant rattachée au couple (Produit × Couleur), toutes les variantes
 * qui partagent la même couleur verront automatiquement la même image — peu
 * importe qu'elles soient UNIT ou PACK, ou qu'il y ait plusieurs variantes
 * pour la même couleur.
 *
 * Stratégie :
 *  1) Image de la couleur principale du produit (`Product.primaryColorId`).
 *     Avec fallback sur la 1ʳᵉ variante `isPrimary=true` pour les produits
 *     non encore migrés (cf. helper `getProductPrimaryColorId`).
 *  2) Sinon : image de la 1ʳᵉ couleur (parmi les variantes triées) qui en a une.
 */
import { getProductPrimaryColorId, type ProductWithColors } from "@/lib/product-primary-color";

export function pickFirstImage(
  product: ProductWithColors,
  imagePathByColorId: (colorId: string | null) => string | null,
): string | null {
  const primaryColorId = getProductPrimaryColorId(product);
  if (primaryColorId) {
    const path = imagePathByColorId(primaryColorId);
    if (path) return path;
  }
  for (const c of product.colors) {
    const path = imagePathByColorId(c.colorId);
    if (path) return path;
  }
  return null;
}
