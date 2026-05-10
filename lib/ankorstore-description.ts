export interface FormatAnkorstoreDescriptionInput {
  description: string;
  reference: string;
  compositions?: { percentage: number | { toString(): string }; composition: { nameFR: string } }[];
}

/**
 * Format the description sent to Ankorstore: original description + composition + reference.
 * Ankorstore requires a minimum of 30 characters in the description field — pad if needed.
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
  lines.push(`\nRéférence : ${input.reference}`);
  const out = lines.join("\n");
  return out.length >= 30 ? out : `${out}\n\nFiche produit complète sur la boutique.`;
}
