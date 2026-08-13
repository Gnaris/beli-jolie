/**
 * Liaison manuelle d'un produit BJ à un produit Ankorstore existant.
 *
 * Stratégie (spec cliente) :
 *   L'admin BJ tape la référence produit BJ dans la modale de liaison.
 *   On interroge Ankor : GET /api/me/brand/products?query=<ref>.
 *   Ankor renvoie une liste ordonnée par pertinence.
 *   On garde uniquement les produits dont AU MOINS UNE variante a un SKU
 *   qui commence par la référence BJ (`{ref}_…`) — car nos SKU sont générés
 *   au format `{reference}_{couleur}_{suffix}` (cf. lib/ankorstore-sku.ts).
 *
 * Retourne un ou plusieurs candidats — c'est l'admin qui tranche via l'UI.
 */

import { searchProducts } from "./read";
import type { BoProductSummary } from "./types";

export interface LinkCandidate {
  product: BoProductSummary;
  /** Nombre de variantes dont le SKU matche notre référence. */
  matchedVariantCount: number;
  /** Score de confiance : 100 = ref exacte trouvée sur au moins 1 variante. */
  confidence: "high" | "medium" | "low";
}

/**
 * Cherche des candidats de liaison pour une référence BJ.
 * Retourne la liste ordonnée du plus probable au moins probable.
 */
export async function findLinkCandidates(referenceBJ: string): Promise<LinkCandidate[]> {
  if (!referenceBJ.trim()) return [];

  const results = await searchProducts(referenceBJ, { limit: 20 });
  const candidates: LinkCandidate[] = [];

  const refUpper = referenceBJ.trim().toUpperCase();

  for (const p of results) {
    const matchedVariants = (p.variants ?? []).filter((v) =>
      v.sku?.toUpperCase().startsWith(refUpper + "_") || v.sku?.toUpperCase() === refUpper
    );
    if (matchedVariants.length === 0) continue;

    let confidence: LinkCandidate["confidence"] = "medium";
    if (matchedVariants.length === (p.variants?.length ?? 0)) confidence = "high";
    if (matchedVariants.length === 1 && (p.variants?.length ?? 0) > 1) confidence = "low";

    candidates.push({
      product: p,
      matchedVariantCount: matchedVariants.length,
      confidence,
    });
  }

  return candidates.sort((a, b) => {
    const rank = { high: 3, medium: 2, low: 1 };
    return rank[b.confidence] - rank[a.confidence] || b.matchedVariantCount - a.matchedVariantCount;
  });
}
