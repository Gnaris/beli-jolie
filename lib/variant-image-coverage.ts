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
 * `true` si au moins une couleur du produit a au moins une image.
 * Sert au check d'auto-OFFLINE : on ne force OFFLINE que si AUCUNE couleur
 * n'a d'image (cas d'un produit vraiment vide), pas dès qu'une seule manque.
 */
export function anyVariantHasImage(variants: VariantForCoverage[]): boolean {
  if (variants.length === 0) return false;
  const totals = new Map<string, number>();
  for (const v of variants) {
    const key = variantGroupKey(v);
    totals.set(key, (totals.get(key) ?? 0) + v.imageCount);
  }
  for (const n of totals.values()) {
    if (n > 0) return true;
  }
  return false;
}

/**
 * Renvoie le Set des `colorId` qui ont au moins une image attachée au produit.
 * Source : `Product.colorImages` (modèle au niveau produit), où chaque entrée
 * porte un `colorId`. Couvre indistinctement UNIT et PACK : une variante est
 * "couverte" dès que sa couleur a au moins une image.
 */
export function colorIdsWithImages(
  colorImages: { colorId: string }[],
): Set<string> {
  return new Set(colorImages.map((ci) => ci.colorId));
}

/**
 * Filtre les variantes en ne gardant que celles dont la couleur a au moins
 * une image. Une variante sans `colorId` est exclue.
 *
 * Utilisé côté push marketplace pour ne jamais envoyer une variante sans image
 * (PFS / Ankorstore / eFashion). Voir CLAUDE.md pour la règle métier.
 */
export function filterVariantsWithImages<T extends { colorId: string | null }>(
  variants: T[],
  colorImages: { colorId: string }[],
): T[] {
  const set = colorIdsWithImages(colorImages);
  return variants.filter((v) => v.colorId != null && set.has(v.colorId));
}

/**
 * Variante du filtre quand on dispose déjà du `Set<colorId>` (par exemple
 * construit depuis une `Map<colorId, …>`).
 */
export function filterVariantsByColorIdSet<T extends { colorId: string | null }>(
  variants: T[],
  allowedColorIds: Set<string>,
): T[] {
  return variants.filter((v) => v.colorId != null && allowedColorIds.has(v.colorId));
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
