/**
 * lib/log-events.ts
 *
 * Helpers de formatage pour les logs production multi-ligne.
 * Voir docs/superpowers/specs/2026-05-09-logs-pm2-lisibles-design.md.
 */

export const PREFIX_TO_EVENT: Record<string, string> = {
  "PFS Images": "Image PFS",
  "PFS": "Synchronisation PFS",
  "Storage": "Stockage de fichier",
  "Email": "Envoi d'email",
  "Stripe": "Paiement Stripe",
  "Easy-Express": "Calcul de transport",
  "Auth": "Connexion / inscription",
  "Order": "Commande",
  "Cart": "Panier",
  "Import": "Importation produit",
  "VIES": "Vérification TVA européenne",
  "DnD": "Réorganisation images",
  "IMG_SYNC": "Synchro image PFS",
  "Webhook": "Webhook entrant",
};

const PREFIX_REGEX = /^\[([^\]]+)\]\s*(.*)$/;

export function deduceEvent(message: string): { event: string; cleanMessage: string } {
  const match = message.match(PREFIX_REGEX);
  if (!match) {
    return { event: "Erreur non catégorisée", cleanMessage: message.trim() };
  }
  const [, prefix, rest] = match;
  const event = PREFIX_TO_EVENT[prefix] ?? "Erreur non catégorisée";
  return { event, cleanMessage: rest.trim() };
}
