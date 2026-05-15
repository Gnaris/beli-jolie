export type AnkorstoreCompositionInput = {
  percentage: number | { toString(): string };
  composition: { nameFR: string };
};

/**
 * Formate l'etiquette `material` envoyee comme option de variante a
 * Ankorstore. Elle alimente la section "Composition" du produit cote
 * Ankorstore (distincte de la description en clair). Retourne null quand
 * aucune composition n'est renseignee : on n'enverra alors pas l'option.
 *
 * Format : "50% Acier inoxydable, 50% Laiton" (memes labels que dans la
 * description, mais sans le prefixe "Composition : ").
 */
export function formatAnkorstoreCompositionLabel(
  compositions: AnkorstoreCompositionInput[] | undefined,
): string | null {
  if (!compositions || compositions.length === 0) return null;
  const parts = compositions
    .map((c) => {
      const pct = Number(c.percentage);
      const name = c.composition.nameFR?.trim() ?? "";
      if (!name) return null;
      return `${pct}% ${name}`;
    })
    .filter((s): s is string => s !== null);
  if (parts.length === 0) return null;
  return parts.join(", ");
}

export interface FormatAnkorstoreDescriptionInput {
  description: string;
  reference: string;
  compositions?: AnkorstoreCompositionInput[];
  /**
   * Diamètre du produit en cm. Ankorstore n'a pas de champ structuré pour
   * ça (seulement longueur/largeur/hauteur), donc on l'ajoute en clair
   * dans la description quand renseigné côté local.
   */
  dimensionDiameter?: number | null;
  /**
   * Circonférence du produit en cm. Même raison que le diamètre — ajoutée
   * dans la description, pas envoyée comme champ structuré.
   */
  dimensionCircumference?: number | null;
}

/**
 * Préfixe figé de la ligne référence appendée à chaque description envoyée à
 * Ankorstore. Exposé pour que la validation côté formulaire puisse calculer
 * combien de caractères seront automatiquement ajoutés.
 */
export const ANKORSTORE_REFERENCE_LINE_PREFIX = "Référence produit : ";

/**
 * Retourne le nombre de caractères que la ligne référence (incluant les deux
 * sauts de ligne qui la séparent du reste) ajoutera à la description envoyée
 * à Ankorstore pour une référence donnée. Utilisé par le formulaire produit
 * pour relâcher la contrainte "30 caractères minimum" : l'utilisatrice ne
 * doit pas avoir à taper 30 caractères si la ligne référence en couvre déjà
 * une partie.
 */
export function getAnkorstoreReferenceSuffixLength(reference: string): number {
  const ref = (reference ?? "").trim();
  if (!ref) return 0;
  return `\n\n${ANKORSTORE_REFERENCE_LINE_PREFIX}${ref}`.length;
}

/**
 * Format the description sent to Ankorstore: original description + composition + reference.
 * Ankorstore requires a minimum of 30 characters in the description field — pad if needed.
 *
 * Le diamètre et la circonférence (non supportés par l'API Ankorstore au
 * niveau dimensions structurées) sont ajoutés ici en texte libre.
 */
export function formatAnkorstoreDescription(input: FormatAnkorstoreDescriptionInput): string {
  const lines: string[] = [];
  const base = input.description?.trim() || "Produit de notre boutique.";
  lines.push(base);
  if (input.compositions && input.compositions.length > 0) {
    const compoStr = input.compositions
      .map((c) => `${Number(c.percentage)}% ${c.composition.nameFR}`)
      .join(", ");
    lines.push(`\nComposition : ${compoStr}`);
  }
  const extraDims: string[] = [];
  if (input.dimensionDiameter && input.dimensionDiameter > 0) {
    extraDims.push(`Diamètre : ${input.dimensionDiameter} cm`);
  }
  if (input.dimensionCircumference && input.dimensionCircumference > 0) {
    extraDims.push(`Circonférence : ${input.dimensionCircumference} cm`);
  }
  if (extraDims.length > 0) {
    lines.push(`\n${extraDims.join(" · ")}`);
  }
  lines.push(`\n${ANKORSTORE_REFERENCE_LINE_PREFIX}${input.reference}`);
  const out = lines.join("\n");
  return out.length >= 30 ? out : `${out}\n\nFiche produit complète sur la boutique.`;
}
