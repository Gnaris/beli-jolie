/**
 * Normalise un commentaire client saisi au checkout : trim + plafond à 1000
 * caractères. Renvoie `null` si l'entrée est vide ou faite uniquement
 * d'espaces, pour ne jamais écrire une chaîne vide dans Order.customerNote.
 *
 * L'UI pose déjà la contrainte 1000 côté textarea (maxLength + slice onChange).
 * Ce helper reste le dernier filet côté serveur : si quelqu'un bypass l'UI
 * (devtools, re-post d'un ancien body…), on tronque sans erreur.
 */
export function normalizeCustomerNote(input: string | undefined | null): string | null {
  if (!input) return null;
  const trimmed = input.trim();
  if (trimmed.length === 0) return null;
  return trimmed.slice(0, 1000);
}
