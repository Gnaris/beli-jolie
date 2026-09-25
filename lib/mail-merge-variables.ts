/**
 * Variables (« merge tags ») utilisables dans le sujet et les textes des
 * modèles de mail. Au moment de l'envoi, chaque `{token}` est remplacé par la
 * vraie donnée du client destinataire.
 *
 * Convention : tokens en camelCase, une seule paire d'accolades, pas d'espaces
 * (`{firstName}`, pas `{ first Name }`). Convention alignée sur les tokens
 * `{firstName}` et `{days}` déjà utilisés dans `mail-scenario-defaults.ts`.
 *
 * Ce module est PUR (0 dépendance serveur) — safe pour import client.
 */

import type { ScenarioKey } from "@/lib/mail-scenario-defaults";

/* ─────────────────────────────────────────────
   Liste des variables
   ───────────────────────────────────────────── */

export type VariableGroup = "client" | "boutique" | "dynamique" | "legal";

export interface MailVariable {
  token: string;         // sans les accolades (ex. "firstName")
  label: string;         // libellé humain (ex. "Prénom")
  hint?: string;         // description courte
  group: VariableGroup;
  /** Si présent, la variable n'est proposée que pour ces scénarios. */
  scenarios?: ScenarioKey[];
  /** Valeur fictive utilisée dans l'aperçu de l'éditeur. */
  previewValue: string;
  /**
   * Variable requise dans les mails marketing (newsletter + 3 scénarios).
   * L'éditeur bloque la sauvegarde du modèle si absente. Sert à garantir
   * la conformité RGPD/LCEN : nom + adresse de l'expéditeur + désinscription
   * + politique de confidentialité doivent apparaître quelque part.
   */
  requiredMarketing?: boolean;
}

export const MAIL_VARIABLES: MailVariable[] = [
  // ── Client ──
  { token: "firstName",     label: "Prénom",              group: "client", previewValue: "Marie" },
  { token: "lastName",      label: "Nom",                 group: "client", previewValue: "Dupont" },
  { token: "fullName",      label: "Prénom + Nom",        group: "client", previewValue: "Marie Dupont" },
  { token: "email",         label: "E-mail",              group: "client", previewValue: "marie.dupont@example.com" },
  { token: "company",       label: "Entreprise",          group: "client", previewValue: "Boutique de Marie" },
  { token: "phone",         label: "Téléphone",           group: "client", previewValue: "06 12 34 56 78" },
  { token: "siret",         label: "SIRET",               group: "client", previewValue: "123 456 789 00012" },
  { token: "tvaIntra",      label: "N° TVA intracom.",    group: "client", previewValue: "FR12345678900" },
  { token: "address",       label: "Adresse",             group: "client", previewValue: "12 rue des Fleurs" },
  { token: "postalCode",    label: "Code postal",         group: "client", previewValue: "75001" },
  { token: "city",          label: "Ville",               group: "client", previewValue: "Paris" },
  { token: "country",       label: "Pays",                group: "client", previewValue: "France" },
  { token: "orderCount",    label: "Nombre de commandes", group: "client", previewValue: "12" },
  { token: "totalSpent",    label: "Total dépensé",       group: "client", hint: "Total TTC toutes commandes", previewValue: "1 240,50 €" },
  { token: "lastOrderDate", label: "Dernière commande",   group: "client", hint: "Date de la dernière commande", previewValue: "il y a 12 jours" },

  // ── Boutique ──
  { token: "shopName",      label: "Nom de la boutique",  group: "boutique", previewValue: "Beli & Jolie", requiredMarketing: true, hint: "Obligatoire par la loi (identifier l'expéditeur)" },
  { token: "shopAddress",   label: "Adresse boutique",    group: "boutique", previewValue: "90 rue de la Haie Coq, 93300 Aubervilliers", requiredMarketing: true, hint: "Obligatoire par la loi (adresse physique de l'expéditeur)" },
  { token: "shopEmail",     label: "E-mail boutique",     group: "boutique", previewValue: "contact@beliandjolie.com" },
  { token: "shopPhone",     label: "Téléphone boutique",  group: "boutique", previewValue: "07 82 75 81 58" },
  { token: "shopWebsite",   label: "Site web",            group: "boutique", previewValue: "beliandjolie.com" },

  // ── Dynamiques (scénarios) ──
  { token: "cartTotal",     label: "Total du panier",     group: "dynamique", scenarios: ["ABANDONED_CART"], previewValue: "84,50 €" },
  { token: "cartCount",     label: "Nombre d'articles",   group: "dynamique", scenarios: ["ABANDONED_CART"], previewValue: "3" },
  { token: "days",          label: "Jours d'inactivité",  group: "dynamique", scenarios: ["INACTIVE_CLIENT"], previewValue: "45" },
  { token: "favoritesCount", label: "Nombre de favoris",  group: "dynamique", scenarios: ["RESTOCK"], previewValue: "2" },

  // ── Mentions légales (obligatoires marketing) ──
  {
    token: "unsubscribeLink",
    label: "Lien de désinscription",
    group: "legal",
    previewValue: "https://exemple.com/desinscription",
    requiredMarketing: true,
    hint: "Obligatoire par la loi (RGPD/LCEN) — 1 clic désinscrit le client",
  },
  {
    token: "privacyLink",
    label: "Politique de confidentialité",
    group: "legal",
    previewValue: "https://exemple.com/politique-de-confidentialite",
    requiredMarketing: true,
    hint: "Obligatoire par la loi (RGPD) — page décrivant l'usage des données",
  },
];

export const VARIABLE_GROUP_LABELS: Record<VariableGroup, string> = {
  client: "Infos client",
  boutique: "Infos boutique",
  dynamique: "Données du mail",
  legal: "Mentions légales",
};

/**
 * Retourne les variables disponibles pour un scénario donné :
 * - Toutes les variables communes (client + boutique)
 * - Les dynamiques scoped à ce scénario uniquement
 */
export function variablesForScenario(scenario: ScenarioKey | null): MailVariable[] {
  return MAIL_VARIABLES.filter((v) => {
    if (!v.scenarios) return true; // commune
    return scenario !== null && v.scenarios.includes(scenario);
  });
}

/* ─────────────────────────────────────────────
   Interpolation
   ───────────────────────────────────────────── */

export type MailMergeContext = Partial<Record<string, string>>;

/**
 * Remplace tous les `{token}` d'une chaîne par leur valeur dans le context.
 * Les tokens inconnus (typo, variable pas encore branchée) sont conservés
 * tels quels — évite qu'un mail parte avec des `{firstName}` vides sans que
 * la cliente s'en rende compte (au contraire, ça saute aux yeux à la relecture).
 *
 * Escape optionnel via `escape` (ex. escapeHtml) — appelé sur CHAQUE valeur
 * substituée avant réinjection. Les tokens laissés tels quels ne sont pas
 * escapés (ils sont déjà safe : que des lettres + accolades).
 */
export function interpolate(
  input: string,
  context: MailMergeContext,
  escape?: (s: string) => string,
): string {
  if (!input) return input;
  return input.replace(/\{([a-zA-Z][a-zA-Z0-9_.]*)\}/g, (match, token: string) => {
    const value = context[token];
    if (value === undefined || value === null) return match; // token inconnu → conservé
    return escape ? escape(String(value)) : String(value);
  });
}

/**
 * Overrides pour les tokens « boutique » — passer les vraies valeurs du tenant
 * courant pour que la preview côté client (fallback avant réponse serveur)
 * affiche « L'équipe ISSYMA–FORCYMA » plutôt que la valeur d'exemple câblée
 * en dur dans `MAIL_VARIABLES`. Sans ça, un admin Issyma voit brièvement
 * « Beli & Jolie » dans son propre éditeur (fuite visuelle cross-tenant).
 */
export interface PreviewOverrides {
  shopName?: string;
  shopAddress?: string;
  shopEmail?: string;
  shopPhone?: string;
  shopWebsite?: string;
}

/**
 * Construit un context d'aperçu à partir des `previewValue` de chaque variable.
 * Utilisé côté éditeur pour montrer un aperçu réaliste sans avoir de vrai user.
 *
 * `overrides` : valeurs du tenant courant qui remplacent les `previewValue`
 * câblés en dur (surtout `shopName`) — indispensable en multi-tenant.
 */
export function buildPreviewContext(
  scenario: ScenarioKey | null,
  overrides?: PreviewOverrides,
): MailMergeContext {
  const ctx: MailMergeContext = {};
  for (const v of variablesForScenario(scenario)) {
    ctx[v.token] = v.previewValue;
  }
  if (overrides) {
    for (const [k, v] of Object.entries(overrides)) {
      if (typeof v === "string" && v.trim()) ctx[k] = v;
    }
  }
  return ctx;
}

/* ─────────────────────────────────────────────
   Variables obligatoires (mails marketing)
   ───────────────────────────────────────────── */

/** Liste des variables marquées `requiredMarketing: true`. */
export const REQUIRED_MARKETING_VARIABLES: MailVariable[] = MAIL_VARIABLES.filter(
  (v) => v.requiredMarketing === true,
);

/**
 * Détecte quelles variables obligatoires manquent dans le contenu d'un modèle
 * marketing (sujet + tous les textes visibles des blocs). Retourne la liste
 * des variables absentes (vide si tout est ok).
 *
 * `hayContent` est concaténé au préalable par le caller (sujet + textes de
 * blocs), pour rester DOM-agnostic (fonctionne côté client et serveur).
 */
export function missingRequiredMarketingVariables(hayContent: string): MailVariable[] {
  return REQUIRED_MARKETING_VARIABLES.filter((v) => {
    const literal = `{${v.token}}`;
    return !hayContent.includes(literal);
  });
}

/* ─────────────────────────────────────────────
   Tokens obligatoires par scénario auto
   ───────────────────────────────────────────── */

/**
 * Un token obligatoire pour un scénario auto. `literal` est la chaîne exacte
 * à chercher dans le HTML source (avant interpolation). Si le token est
 * absent, la sauvegarde du modèle est refusée — sans ça, l'admin risque
 * d'envoyer un mail « Panier abandonné » qui ne contient PAS la liste des
 * articles, ce qui n'aurait aucun sens pour le client.
 */
export interface ScenarioTokenSpec {
  token: string;
  label: string;
  literal: string;
}

export const SCENARIO_REQUIRED_TOKENS: Record<ScenarioKey, ScenarioTokenSpec[]> = {
  // Boucle `{{#each cart}}` désormais FACULTATIVE (décision cliente 2026-09-25) :
  // la boucle produits est développée automatiquement si présente, sinon le
  // mail est envoyé sans elle. Utile pour les Stades 2/3 où la cliente veut
  // parfois un mail plus court ou une simple relance conversationnelle.
  ABANDONED_CART: [],
  INACTIVE_CLIENT: [],
  RESTOCK: [],
};

/**
 * Détecte les tokens dynamiques obligatoires manquants pour un scénario
 * auto donné. Retourne [] si scénario null (mail libre) ou si tout est
 * présent. À brancher AVANT la sauvegarde d'un modèle lié à un scénario.
 */
export function missingScenarioTokens(
  html: string,
  scenario: ScenarioKey | null,
): ScenarioTokenSpec[] {
  if (!scenario) return [];
  const required = SCENARIO_REQUIRED_TOKENS[scenario] ?? [];
  return required.filter((r) => !html.includes(r.literal));
}
