/**
 * Détermine quelles compositions de couleurs n'ont aucune image.
 *
 * Une "composition" = colorId principal + colorIds des sous-couleurs (ordre
 * conservé). Deux variantes (par ex. UNIT et PACK de la même couleur)
 * partagent la même composition et donc le même jeu d'images : si l'une
 * possède au moins une image, l'autre est considérée comme couverte.
 *
 * Cette logique miroite ce que voit l'admin dans le formulaire (un seul jeu
 * d'images par couleur), et l'import PFS lui-même ne télécharge qu'une fois
 * les images par couleur en les rattachant à la première variante rencontrée.
 */

export interface VariantForCoverage {
  id: string;
  colorId: string | null;
  colorName?: string | null;
  subColors: { colorId: string; colorName?: string | null; position: number }[];
  imageCount: number;
}

export interface MissingCoverageEntry {
  /** Libellé lisible (ex. "Argent + Doré") pour affichage à l'admin. */
  label: string;
  /** Identifiants des variantes qui partagent cette composition. */
  variantIds: string[];
}

/** Clé de groupe identique à `variantGroupKeyFromState` côté client. */
export function variantGroupKey(v: VariantForCoverage): string {
  if (!v.colorId) return "";
  if (v.subColors.length === 0) return v.colorId;
  const ordered = [...v.subColors].sort((a, b) => a.position - b.position).map((s) => s.colorId);
  return `${v.colorId}::${ordered.join(",")}`;
}

function variantLabel(v: VariantForCoverage): string {
  const main = v.colorName?.trim() || "variante";
  const subs = [...v.subColors]
    .sort((a, b) => a.position - b.position)
    .map((s) => s.colorName?.trim())
    .filter((n): n is string => !!n);
  return subs.length > 0 ? `${main} + ${subs.join(" + ")}` : main;
}

/**
 * Renvoie la liste des compositions de couleurs sans aucune image, sous
 * forme prête à afficher à l'admin. Liste vide → toutes les couleurs sont
 * couvertes (au moins une image par composition).
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
