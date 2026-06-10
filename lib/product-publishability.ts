/**
 * Évalue si un produit (typiquement un brouillon OFFLINE) peut être mis en
 * ligne et publié sur les marketplaces. Réplique côté serveur des règles de
 * `getCompletenessErrors()` du formulaire produit (components/admin/products/
 * ProductForm.tsx), pour pouvoir donner une liste précise des raisons quand on
 * tente une publication en masse depuis l'admin.
 *
 * Pure fonction : pas d'I/O. Le caller fournit un objet déjà chargé depuis
 * Prisma (avec ses relations).
 */

export const DESCRIPTION_MIN_CHARS = 30;

export interface PublishabilitySize {
  sizeId: string;
  sizeName: string | null;
  quantity: number;
}

export interface PublishabilityVariant {
  id: string;
  colorId: string | null;
  colorName: string | null;
  unitPrice: number;
  stock: number | null;
  weight: number;
  saleType: "UNIT" | "PACK";
  packQuantity: number | null;
  sizes: PublishabilitySize[];
  /**
   * Pour les PACK multi-couleurs : nb de lignes packLines. Si > 0, la variante
   * a un pack multi-couleurs (variantSizes peut être vide) et la complétude
   * des tailles est portée par les packLines.
   */
  packLinesCount: number;
  packLinesSizesTotal: number;
}

export interface PublishabilityProduct {
  id: string;
  reference: string;
  name: string;
  description: string;
  categoryId: string | null;
  compositionPercentTotal: number;
  compositionCount: number;
  variants: PublishabilityVariant[];
  /** Nombre d'images par colorId (extrait d'un groupBy ProductColorImage). */
  imageCountByColorId: Record<string, number>;
}

export interface PublishabilityResult {
  /** Vrai si le produit peut être passé ONLINE et publié sur les marketplaces. */
  eligible: boolean;
  /** Liste lisible des raisons d'inéligibilité (vide si éligible). */
  reasons: string[];
}

/**
 * Calcule l'éligibilité d'un produit à la mise en ligne et la publication
 * marketplaces. Reproduit fidèlement les règles du formulaire admin.
 */
export function evaluateProductPublishability(
  product: PublishabilityProduct,
): PublishabilityResult {
  const reasons: string[] = [];

  if (!product.reference.trim()) reasons.push("Référence produit manquante");
  if (!product.name.trim()) reasons.push("Nom du produit manquant");

  const descLen = product.description.trim().length;
  if (descLen === 0) {
    reasons.push("Description manquante");
  } else if (descLen < DESCRIPTION_MIN_CHARS) {
    reasons.push(`Description trop courte (${DESCRIPTION_MIN_CHARS} caractères minimum)`);
  }

  if (!product.categoryId) reasons.push("Catégorie non sélectionnée");

  if (product.compositionCount === 0) {
    reasons.push("Au moins une composition est requise");
  } else if (Math.abs(product.compositionPercentTotal - 100) > 0.5) {
    reasons.push(
      `La composition doit totaliser 100% (actuel : ${product.compositionPercentTotal.toFixed(1)}%)`,
    );
  }

  if (product.variants.length === 0) {
    reasons.push("Au moins une variante de couleur est requise");
  } else {
    // Image par couleur : on déduplique par colorId (toutes les variantes d'une
    // même couleur partagent le même jeu d'images).
    const checkedColorIds = new Set<string>();
    for (const v of product.variants) {
      if (!v.colorId) continue;
      if (checkedColorIds.has(v.colorId)) continue;
      checkedColorIds.add(v.colorId);
      const count = product.imageCountByColorId[v.colorId] ?? 0;
      if (count === 0) {
        const label = v.colorName || "variante pack";
        reasons.push(`Variante "${label}" : aucune image`);
      }
    }

    for (const v of product.variants) {
      const label = v.colorName || "variante pack";
      if (!v.colorId) reasons.push(`Variante "${label}" : couleur non sélectionnée`);
      if (!Number.isFinite(v.weight) || v.weight <= 0) {
        reasons.push(`Variante "${label}" : poids invalide`);
      }
      if (!Number.isFinite(v.unitPrice) || v.unitPrice <= 0) {
        reasons.push(`Variante "${label}" : prix/unité invalide`);
      }
      if (v.stock === null || v.stock === undefined) {
        reasons.push(`Variante "${label}" : stock non renseigné`);
      }
      const hasSimpleSizes = v.sizes.length > 0;
      const hasPackLineSizes = v.packLinesCount > 0 && v.packLinesSizesTotal > 0;
      if (!hasSimpleSizes && !hasPackLineSizes) {
        reasons.push(`Variante "${label}" : aucune taille`);
      }
      if (v.saleType === "PACK") {
        const qty = v.packQuantity ?? 0;
        if (!Number.isInteger(qty) || qty < 1) {
          reasons.push(`Variante "${label}" : quantité paquet invalide`);
        }
        for (const se of v.sizes) {
          if (!Number.isInteger(se.quantity) || se.quantity <= 0) {
            reasons.push(
              `Variante "${label}" : quantité invalide pour taille "${se.sizeName ?? "?"}"`,
            );
          }
        }
      }
    }
  }

  return { eligible: reasons.length === 0, reasons };
}
