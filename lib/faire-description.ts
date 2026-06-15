/**
 * Ajoute à la fin de la description produit envoyée à Faire les infos
 * matériaux + code SH, parce que ces champs ne sont pas exposés à l'acheteuse
 * dans le schéma Faire (composition) ou pas affichés en clair (tariff_code).
 * Les dimensions et le poids passent par le champ structuré `measurements`
 * côté variante (cf. `lib/faire-publish.ts → buildFaireProductPayload`).
 *
 * Format de sortie :
 *
 *     {description originale}
 *
 *     Composition : Acier inoxydable 316L (70%), Plaqué or 18 carats (30%)
 *     Code SH : 7117.19.00
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
  hsCode: string | null,
): string {
  const lines: string[] = [];
  const base = baseDescription?.trim() ?? "";
  if (base) lines.push(base);

  const compositionLine = formatCompositionLine(compositions);
  if (compositionLine) lines.push(compositionLine);

  const hs = hsCode?.trim();
  if (hs) lines.push(`Code SH : ${hs}`);

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
