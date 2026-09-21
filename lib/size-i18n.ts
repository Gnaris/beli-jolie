/**
 * Traduit les noms de taille figés en base ("Taille unique", "TU", "one size")
 * vers le libellé localisé passé par l'appelant. Les tailles alphanumériques
 * (S, M, 36, …) sont universelles et restent inchangées.
 */
export function translateSizeName(name: string, oneSizeLabel: string): string {
  const trimmed = name.trim();
  if (
    trimmed === "Taille unique" ||
    trimmed === "TU" ||
    trimmed.toLowerCase() === "one size"
  ) {
    return oneSizeLabel;
  }
  return trimmed;
}
