/**
 * Garantit qu'exactement une variante porte isPrimary=true.
 * Si plusieurs sont marquées primaires (cas legacy : à la création, l'ancien
 * code forçait toujours i=0 à isPrimary=true en plus de la variante choisie
 * par l'utilisateur), on ne conserve que la **dernière** — celle que
 * l'utilisateur a explicitement cochée. Si aucune n'est marquée, la variante
 * d'index 0 le devient.
 */
export function normalizePrimaryFlag<T extends { isPrimary: boolean }>(colors: T[]): T[] {
  if (colors.length === 0) return colors;
  let primaryIdx = -1;
  for (let i = 0; i < colors.length; i++) {
    if (colors[i].isPrimary) primaryIdx = i;
  }
  if (primaryIdx === -1) primaryIdx = 0;
  return colors.map((c, i) => ({ ...c, isPrimary: i === primaryIdx }));
}
