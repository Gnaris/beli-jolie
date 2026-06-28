/**
 * Ajoute à la fin de la description produit envoyée à Faire la composition
 * matériaux, parce que ce champ n'est pas exposé à l'acheteuse dans le schéma
 * Faire. Les dimensions et le poids passent par le champ structuré
 * `measurements` côté variante (cf. `lib/faire-publish.ts → buildFaireProductPayload`).
 * Le code SH reste envoyé en clair via `tariff_code` au niveau variante mais
 * n'est plus appendu à la description (choix cliente : pas pertinent pour
 * l'acheteuse).
 *
 * Format de sortie :
 *
 *     {description originale}
 *
 *     Composition : Acier inoxydable 316L (70%), Plaqué or 18 carats (30%)
 */

export interface FaireDescriptionComposition {
  /** Libellé matériau en clair (ex : "Acier inoxydable 316L"). */
  name: string;
  /** Pourcentage entier (ex : 70 pour 70%). */
  percentage: number;
}

export function buildFaireDescription(
  baseDescription: string,
  compositions: FaireDescriptionComposition[],
): string {
  const lines: string[] = [];
  const base = baseDescription?.trim() ?? "";
  if (base) lines.push(base);

  const compositionLine = formatCompositionLine(compositions);
  if (compositionLine) lines.push(compositionLine);

  return lines.join("\n\n");
}

function formatCompositionLine(compositions: FaireDescriptionComposition[]): string | null {
  const cleaned = compositions
    .map((c) => ({ name: c.name?.trim() ?? "", percentage: Number(c.percentage) }))
    .filter((c) => c.name.length > 0);

  if (cleaned.length === 0) return null;

  const items = cleaned.map((c) => {
    const pct = Number.isFinite(c.percentage) && c.percentage > 0
      ? ` (${roundPercent(c.percentage)}%)`
      : "";
    return `${c.name}${pct}`;
  });

  return `Composition : ${items.join(", ")}`;
}

function roundPercent(pct: number): string {
  const rounded = Math.round(pct * 10) / 10;
  return Number.isInteger(rounded) ? rounded.toFixed(0) : rounded.toFixed(1);
}
