/**
 * Préférences des notifications push PWA (par tenant) — module ISOMORPHE.
 *
 * ⚠️ Ce fichier ne doit RIEN importer qui touche Prisma / next/headers — il
 * est utilisé par le composant client `PushPreferencesEditor.tsx` autant que
 * par les hooks server. La lecture BDD vit dans `lib/push-preferences-server.ts`
 * (seul le serveur l'importe).
 *
 * Pour chaque type d'événement (nouvelle commande, inscription, SAV, chat) :
 *   - `enabled` : true/false — si false, aucun push n'est envoyé
 *   - `title`   : template du titre, placeholders `{xxx}` substitués au vol
 *   - `body`    : template du corps, idem
 *
 * Rangé dans `SiteConfig[push_notification_preferences]` sous forme JSON
 * (une entrée par tenant via la PK composite `(tenantId, key)`).
 *
 * Les templates par défaut reprennent exactement ce que faisait l'ancien code
 * hardcodé dans `push-hooks.ts` — rétrocompatibilité stricte si la cliente
 * n'a jamais ouvert le réglage.
 */

export const PUSH_PREFS_SITE_CONFIG_KEY = "push_notification_preferences";

/** Les 4 types d'événements qui peuvent déclencher une notif push. */
export type PushEventType = "order_new" | "client_new" | "claim_new" | "chat_message";

export const PUSH_EVENT_TYPES: PushEventType[] = ["order_new", "client_new", "claim_new", "chat_message"];

export interface PushEventPreference {
  enabled: boolean;
  title: string;
  body: string;
}

export type PushPreferences = Record<PushEventType, PushEventPreference>;

/**
 * Placeholders autorisés par type d'événement — exposés à l'UI pour afficher
 * l'aide « Vous pouvez utiliser {customer}, {amount}… ». La lib
 * `renderTemplate()` ignore tout placeholder inconnu plutôt que de crasher
 * (on remplace par chaîne vide).
 */
export const PUSH_EVENT_PLACEHOLDERS: Record<PushEventType, readonly string[]> = {
  order_new:    ["customer", "amount", "orderNumber"],
  client_new:   ["customer"],
  claim_new:    ["customer", "subject", "reference"],
  chat_message: ["sender", "preview"],
};

/**
 * Valeurs d'exemple utilisées pour l'aperçu + le bouton Tester.
 * Partagées entre lib (server-side pour envoi test) et UI (preview visuelle)
 * pour garantir que l'aperçu colle à ce que la cliente reçoit réellement.
 */
export const PUSH_EVENT_PREVIEW_VALUES: Record<string, string> = {
  customer: "Bijoux Dupont",
  amount: "250,00 €",
  orderNumber: "ABCD1234",
  subject: "Collier défectueux",
  reference: "SAV-2026-0012",
  sender: "Marie Dupont",
  preview: "Bonjour, est-ce que la commande est toujours en préparation ?",
};

/**
 * Libellés UI des événements — affichés dans la carte Paramètres (en français).
 */
export const PUSH_EVENT_LABELS: Record<PushEventType, { title: string; description: string }> = {
  order_new: {
    title: "Nouvelle commande",
    description: "Un client vient de passer commande et de payer.",
  },
  client_new: {
    title: "Nouvelle inscription",
    description: "Un nouveau client vient de créer un compte.",
  },
  claim_new: {
    title: "Nouveau SAV",
    description: "Un client ouvre un nouveau ticket Service Client.",
  },
  chat_message: {
    title: "Message chat / SAV",
    description: "Un client vous écrit via le chat ou répond dans un SAV existant.",
  },
};

/**
 * Valeurs par défaut — reprennent le texte historique hardcodé.
 * Toute boutique qui n'ouvre jamais l'écran reste sur ces libellés.
 */
export const DEFAULT_PUSH_PREFERENCES: PushPreferences = {
  order_new: {
    enabled: true,
    title: "Nouvelle commande · {amount}",
    body: "{customer} · {orderNumber}",
  },
  client_new: {
    enabled: true,
    title: "Nouvelle inscription",
    body: "{customer} vient de créer un compte.",
  },
  claim_new: {
    enabled: true,
    title: "Nouveau SAV · {customer}",
    body: "{subject}",
  },
  chat_message: {
    enabled: true,
    // Titre affiché selon contexte : pour un SAV existant on affiche
    // « Nouveau SAV · … » ; pour un chat normal, « Message · … ». Le lib
    // choisit le bon template côté push-hooks selon event.context.
    title: "Message · {sender}",
    body: "{preview}",
  },
};

/**
 * Remplace les `{placeholder}` dans le template par la valeur fournie.
 * Un placeholder inconnu / vide est remplacé par chaîne vide (pas d'erreur).
 * Les séquences de `·` restants autour d'un placeholder vide sont nettoyées
 * pour éviter « Nouvelle commande ·  » quand le montant manque.
 */
export function renderTemplate(
  template: string,
  values: Record<string, string | number | null | undefined>,
): string {
  const rendered = template.replace(/\{(\w+)\}/g, (_, key: string) => {
    const v = values[key];
    if (v === null || v === undefined || v === "") return "";
    return String(v);
  });
  // Nettoyage : séparateurs orphelins quand un placeholder était vide.
  return rendered
    .replace(/\s*·\s*·\s*/g, " · ")
    .replace(/^\s*·\s*/, "")
    .replace(/\s*·\s*$/, "")
    .replace(/\s{2,}/g, " ")
    .trim();
}

/**
 * Parse un JSON brut en préférences, en complétant chaque entrée manquante
 * avec le défaut. Tolère un format partiel (ex: seul `order_new` défini) et
 * ignore les clés inconnues (évite une injection de type d'événement).
 */
export function parsePushPreferences(raw: string): PushPreferences {
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    return DEFAULT_PUSH_PREFERENCES;
  }
  if (!data || typeof data !== "object") return DEFAULT_PUSH_PREFERENCES;
  const parsed = data as Record<string, Partial<PushEventPreference>>;
  const result = { ...DEFAULT_PUSH_PREFERENCES };
  for (const type of PUSH_EVENT_TYPES) {
    const entry = parsed[type];
    if (!entry || typeof entry !== "object") continue;
    result[type] = {
      enabled: typeof entry.enabled === "boolean" ? entry.enabled : DEFAULT_PUSH_PREFERENCES[type].enabled,
      title: typeof entry.title === "string" && entry.title.trim() ? entry.title : DEFAULT_PUSH_PREFERENCES[type].title,
      body: typeof entry.body === "string" && entry.body.trim() ? entry.body : DEFAULT_PUSH_PREFERENCES[type].body,
    };
  }
  return result;
}
