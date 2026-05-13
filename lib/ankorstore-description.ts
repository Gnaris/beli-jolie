export interface FormatAnkorstoreDescriptionInput {
  description: string;
  reference: string;
  compositions?: { percentage: number | { toString(): string }; composition: { nameFR: string } }[];
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
  lines.push(`\nRéférence : ${input.reference}`);
  const out = lines.join("\n");
  return out.length >= 30 ? out : `${out}\n\nFiche produit complète sur la boutique.`;
}
