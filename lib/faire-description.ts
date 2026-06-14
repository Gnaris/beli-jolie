/**
 * Ajoute à la fin de la description produit envoyée à Faire les infos
 * matériaux + code SH, parce que ces champs structurés (`materials`,
 * `hs_code`/`tariff_code`) ne sont soit pas exposés à l'acheteuse côté
 * Faire, soit non documentés. La description reste le seul endroit
 * garanti où l'acheteuse verra ces infos.
 *
 * Format de sortie :
 *
 *     {description originale}
 *
 *     Composition : Acier inoxydable 316L (70%), Plaqué or 18 carats (30%)
 *     Code SH : 7117.19.00
 *
 * - Composition : ajoutée tant qu'il y a au moins une ligne renseignée.
 * - Code SH    : ajouté uniquement si non vide.
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
  // Si le pourcentage tombe juste, pas de décimale ; sinon une décimale.
  const rounded = Math.round(pct * 10) / 10;
  return Number.isInteger(rounded) ? rounded.toFixed(0) : rounded.toFixed(1);
}
