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

type CauseRule = { test: (msg: string, name: string) => boolean; cause: string };

export const ERROR_CAUSE_RULES: CauseRule[] = [
  { test: (m) => m.includes("ECONNREFUSED"), cause: "Le service distant refuse la connexion" },
  { test: (m) => m.includes("ETIMEDOUT") || /timeout/i.test(m), cause: "Délai d'attente dépassé" },
  { test: (m) => m.includes("ENOTFOUND") || m.includes("EAI_AGAIN"), cause: "Adresse introuvable (DNS)" },
  { test: (m) => m.includes("ENOENT"), cause: "Fichier ou dossier introuvable" },
  { test: (m) => m.includes("EACCES") || m.includes("EPERM"), cause: "Permission refusée" },
  { test: (m) => m.includes("ENOSPC"), cause: "Plus d'espace disque" },
  { test: (m) => m.includes("Unique constraint failed"), cause: "Cette valeur existe déjà en base" },
  { test: (m) => m.includes("Foreign key constraint failed"), cause: "Lien vers une donnée qui n'existe pas" },
  { test: (m) => m.includes("Record to update not found"), cause: "L'enregistrement à modifier n'existe plus" },
  { test: (_m, name) => name === "JsonWebTokenError", cause: "Jeton de session invalide" },
  { test: (_m, name) => name === "TokenExpiredError", cause: "Jeton de session expiré" },
  { test: (m) => /\b429\b/.test(m), cause: "Trop de requêtes, le service distant nous limite" },
  { test: (m) => /\b(401|403)\b/.test(m), cause: "Non autorisé par le service distant" },
  { test: (m) => /\b(500|502|503|504)\b/.test(m), cause: "Le service distant est en panne ou surchargé" },
];

export function deduceCause(error: unknown): string | null {
  if (!(error instanceof Error)) return null;
  const msg = error.message ?? "";
  const name = error.name ?? "";
  for (const rule of ERROR_CAUSE_RULES) {
    if (rule.test(msg, name)) return rule.cause;
  }
  return null;
}
