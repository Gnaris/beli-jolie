/**
 * lib/email-scenarios.ts
 *
 * Catalogue centralisé des types d'emails tracés dans `EmailSend`.
 * Chaque scénario = un mail *destiné au client* (les mails admin internes
 * ne sont pas tracés — validé avec la cliente).
 *
 * Ajouter un scénario ici, puis le passer via `sendMail({..., tracking: {
 * scenarioKey: EMAIL_SCENARIOS.XXX.key, userId, metadata } })`.
 */

export const EMAIL_SCENARIOS = {
  // ─── Compte & connexion ────────────────────────────────
  LOGIN_OTP: {
    key: "LOGIN_OTP",
    label: "Connexion par code",
    category: "connexion",
  },
  PASSWORD_RESET: {
    key: "PASSWORD_RESET",
    label: "Mot de passe oublié",
    category: "connexion",
  },
  ACCOUNT_APPROVED: {
    key: "ACCOUNT_APPROVED",
    label: "Compte approuvé",
    category: "compte",
  },
  ACCOUNT_REJECTED: {
    key: "ACCOUNT_REJECTED",
    label: "Compte refusé",
    category: "compte",
  },
  ACCOUNT_REVOKED: {
    key: "ACCOUNT_REVOKED",
    label: "Compte désactivé",
    category: "compte",
  },
  EMAIL_CHANGE_CONFIRM: {
    key: "EMAIL_CHANGE_CONFIRM",
    label: "Confirmation nouvel email",
    category: "compte",
  },
  EMAIL_CHANGE_NOTICE: {
    key: "EMAIL_CHANGE_NOTICE",
    label: "Alerte changement d'email",
    category: "compte",
  },

  // ─── Commandes ────────────────────────────────────────
  ORDER_CREATED: {
    key: "ORDER_CREATED",
    label: "Commande reçue",
    category: "commande",
  },
  ORDER_VALIDATED: {
    key: "ORDER_VALIDATED",
    label: "Commande validée",
    category: "commande",
  },
  ORDER_SHIPPED: {
    key: "ORDER_SHIPPED",
    label: "Commande expédiée",
    category: "commande",
  },
  ORDER_CANCELLED: {
    key: "ORDER_CANCELLED",
    label: "Commande annulée",
    category: "commande",
  },
  ORDER_MODIFIED: {
    key: "ORDER_MODIFIED",
    label: "Commande modifiée",
    category: "commande",
  },
  CHECKOUT_PAYMENT_LINK: {
    key: "CHECKOUT_PAYMENT_LINK",
    label: "Lien de paiement",
    category: "commande",
  },

  // ─── Messagerie & réclamations ────────────────────────
  SUPPORT_REPLY: {
    key: "SUPPORT_REPLY",
    label: "Réponse au message",
    category: "support",
  },
  CLAIM_REPLY: {
    key: "CLAIM_REPLY",
    label: "Réponse au Service Client",
    category: "support",
  },

  // ─── Marketing (déjà tracés historiquement) ────────────
  NEWSLETTER: {
    key: "NEWSLETTER",
    label: "Newsletter",
    category: "marketing",
  },
  ABANDONED_CART: {
    key: "ABANDONED_CART",
    label: "Panier abandonné",
    category: "marketing",
  },
  RESTOCK: {
    key: "RESTOCK",
    label: "Retour en stock",
    category: "marketing",
  },
  INACTIVE_CLIENT: {
    key: "INACTIVE_CLIENT",
    label: "Relance inactivité",
    category: "marketing",
  },
} as const;

export type EmailScenarioKey =
  (typeof EMAIL_SCENARIOS)[keyof typeof EMAIL_SCENARIOS]["key"];

export type EmailScenarioCategory =
  | "compte"
  | "connexion"
  | "commande"
  | "support"
  | "marketing";

export const EMAIL_SCENARIO_CATEGORIES: Record<
  EmailScenarioCategory,
  string
> = {
  compte: "Compte",
  connexion: "Connexion",
  commande: "Commandes",
  support: "Support",
  marketing: "Marketing",
};

/**
 * Résout le libellé FR d'un scenarioKey stocké en BDD.
 * Tolère les valeurs inconnues (ex. données historiques) en renvoyant le key brut.
 */
export function getScenarioLabel(key: string): string {
  const entry = Object.values(EMAIL_SCENARIOS).find((s) => s.key === key);
  return entry?.label || key;
}

export function getScenarioCategory(key: string): EmailScenarioCategory | null {
  const entry = Object.values(EMAIL_SCENARIOS).find((s) => s.key === key);
  return entry?.category ?? null;
}

/** Liste triée pour l'UI (filtres). */
export const EMAIL_SCENARIOS_LIST = Object.values(EMAIL_SCENARIOS);
