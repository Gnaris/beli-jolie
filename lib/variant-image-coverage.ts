/**
 * Détermine quelles couleurs n'ont aucune image.
 *
 * Deux variantes UNIT et PACK de la même couleur partagent le même jeu
 * d'images : si l'une possède au moins une image, l'autre est considérée
 * comme couverte.
 */

export interface VariantForCoverage {
  id: string;
  colorId: string | null;
  colorName?: string | null;
  imageCount: number;
}

export interface MissingCoverageEntry {
  label: string;
  variantIds: string[];
}

/** Clé de groupe identique à `variantGroupKeyFromState` côté client. */
export function variantGroupKey(v: VariantForCoverage): string {
  return v.colorId ?? "";
}

function variantLabel(v: VariantForCoverage): string {
  return v.colorName?.trim() || "variante";
}

/**
 * Renvoie la liste des couleurs sans aucune image, prête à afficher à l'admin.
 * Liste vide → toutes les couleurs sont couvertes.
 */
export function findMissingImageCoverage(variants: VariantForCoverage[]): MissingCoverageEntry[] {
  type Group = { label: string; variantIds: string[]; imageCount: number };
  const groups = new Map<string, Group>();
  for (const v of variants) {
    const key = variantGroupKey(v);
    const existing = groups.get(key);
    if (existing) {
      existing.variantIds.push(v.id);
      existing.imageCount += v.imageCount;
    } else {
      groups.set(key, { label: variantLabel(v), variantIds: [v.id], imageCount: v.imageCount });
    }
  }
  const missing: MissingCoverageEntry[] = [];
  for (const g of groups.values()) {
    if (g.imageCount === 0) {
      missing.push({ label: g.label, variantIds: g.variantIds });
    }
  }
  return missing;
}
