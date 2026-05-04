// Helpers pour gérer la couleur principale d'un produit.
//
// La couleur principale est désormais portée par Product.primaryColorId.
// Le champ ProductColor.isPrimary est conservé en BDD pour compatibilité
// transitoire (produits non encore migrés) mais n'est plus écrit par les
// server actions. Le helper getProductPrimaryColorId() lit primaryColorId
// avec un fallback automatique sur isPrimary puis sur la première couleur
// disponible — il sert de point d'entrée unique partout dans l'app.

export type ProductColorLite = {
  colorId: string | null;
  isPrimary?: boolean;
  packLines?: { colorId: string }[];
};

export type ProductWithColors = {
  primaryColorId?: string | null;
  colors: ProductColorLite[];
};

/**
 * Retourne la `colorId` de la couleur principale du produit.
 *
 * Priorité :
 * 1. `Product.primaryColorId` si renseigné
 * 2. Sinon, `ProductColor.colorId` de la 1ʳᵉ variante avec `isPrimary=true`
 * 3. Sinon, `ProductColor.colorId` de la 1ʳᵉ variante (par ordre tableau)
 * 4. Sinon, `colorId` de la 1ʳᵉ pack-line de la 1ʳᵉ variante
 * 5. Sinon, `null`
 */
export function getProductPrimaryColorId(product: ProductWithColors): string | null {
  if (product.primaryColorId) return product.primaryColorId;
  const primaryVariant = product.colors.find((c) => c.isPrimary === true && c.colorId);
  if (primaryVariant?.colorId) return primaryVariant.colorId;
  const firstWithColor = product.colors.find((c) => c.colorId);
  if (firstWithColor?.colorId) return firstWithColor.colorId;
  for (const variant of product.colors) {
    if (variant.packLines && variant.packLines.length > 0) {
      const firstLine = variant.packLines[0];
      if (firstLine?.colorId) return firstLine.colorId;
    }
  }
  return null;
}

/**
 * Construit l'union des `colorId` disponibles pour un produit, dans l'ordre
 * d'apparition (variantes d'abord, puis pack-lines pour les couleurs uniquement
 * présentes dans des paquets multi-couleurs).
 */
export function listAvailableColorIds(product: ProductWithColors): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const variant of product.colors) {
    if (variant.colorId && !seen.has(variant.colorId)) {
      seen.add(variant.colorId);
      result.push(variant.colorId);
    }
    for (const line of variant.packLines ?? []) {
      if (line.colorId && !seen.has(line.colorId)) {
        seen.add(line.colorId);
        result.push(line.colorId);
      }
    }
  }
  return result;
}

/**
 * Détermine la `colorId` principale à utiliser après modification de la liste
 * des couleurs du produit.
 *
 * - Si la couleur actuelle est toujours dans la liste → on la garde
 * - Sinon → on prend la 1ʳᵉ couleur disponible
 * - Si aucune couleur disponible → null
 *
 * Sert au formulaire (auto-réassignation) ET aux server actions
 * (réassignation côté serveur si la valeur fournie est invalide).
 */
export function resolvePrimaryColorId(
  current: string | null | undefined,
  available: string[],
): string | null {
  if (current && available.includes(current)) return current;
  return available[0] ?? null;
}
