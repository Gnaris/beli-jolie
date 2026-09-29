/**
 * Variables et rendu des modèles de messages WhatsApp.
 *
 * Réutilise la logique d'interpolation des mails (`lib/mail-merge-variables`)
 * pour que la cliente n'ait qu'UNE liste de tokens à retenir. On garde
 * uniquement les variables qui ont du sens hors contexte de scénario auto :
 *
 *  - Groupe « client » (15) : firstName, company, phone, etc.
 *  - Groupe « boutique » (5) : shopName, shopAddress, etc.
 *  - Groupe « admin » (2, spécifique WhatsApp) : adminFirstName, adminLastName
 *
 * Les groupes `dynamique` (cartTotal, days…) et `legal` (unsubscribeLink)
 * sont exclus : les premiers dépendent d'un scénario (panier abandonné,
 * réassort…) qui n'a pas de sens dans un envoi manuel, les seconds sont
 * spécifiques au cadre légal du mail marketing.
 *
 * Ce module est PUR (0 dépendance serveur) — safe pour import client.
 */

import {
  MAIL_VARIABLES,
  interpolate,
  type MailMergeContext,
  type MailVariable,
} from "@/lib/mail-merge-variables";

export type WhatsAppMergeContext = MailMergeContext;

/**
 * Nouvelles variables spécifiques WhatsApp — l'admin qui clique. Utiles pour
 * signer le message (« Bonjour Marie, c'est Boris de Beli & Jolie »).
 */
const WHATSAPP_EXTRA_VARIABLES: MailVariable[] = [
  {
    token: "adminFirstName",
    label: "Votre prénom",
    group: "boutique",
    previewValue: "Boris",
    hint: "Prénom de l'admin connecté qui envoie le message",
  },
  {
    token: "adminLastName",
    label: "Votre nom",
    group: "boutique",
    previewValue: "Chen",
    hint: "Nom de l'admin connecté qui envoie le message",
  },
];

/**
 * Variables disponibles dans les modèles WhatsApp. Ordre : client → boutique
 * → admin.
 */
export const WHATSAPP_VARIABLES: MailVariable[] = [
  ...MAIL_VARIABLES.filter((v) => v.group === "client"),
  ...MAIL_VARIABLES.filter((v) => v.group === "boutique"),
  ...WHATSAPP_EXTRA_VARIABLES,
];

export const WHATSAPP_TEMPLATE_TITLE_MAX = 80;
export const WHATSAPP_TEMPLATE_BODY_MAX = 1000;

/**
 * Détecte la présence d'au moins un emoji dans une chaîne. On refuse les
 * emojis dans les modèles WhatsApp car WhatsApp Desktop décode mal les
 * octets UTF-8 des emojis quand ils passent par le paramètre `?text=` de
 * `wa.me` (👋 → �). Interdire la saisie en amont évite à la cliente
 * d'envoyer un message avec des `?` bizarres sans s'en rendre compte.
 *
 * Détection via la propriété Unicode `Extended_Pictographic` (couvre 👋,
 * ✨, ❤, 👉, 🎉…). Les lettres accentuées, chiffres, ponctuation et
 * symboles monétaires ne sont pas ciblés.
 */
export function containsEmoji(text: string): boolean {
  if (!text) return false;
  return /\p{Extended_Pictographic}/u.test(text);
}

export const WHATSAPP_NO_EMOJI_ERROR =
  "Les emojis ne sont pas acceptés dans les modèles WhatsApp (👋 ✨ 👉…). Retirez-les pour continuer.";

/**
 * Modèle par défaut, utilisé pour l'aperçu quand la cliente ouvre le drawer
 * de création d'un nouveau modèle avec un textarea vide. Ne sert PAS de
 * fallback à l'usage — un modèle vide n'est jamais persisté.
 */
export const WHATSAPP_TEMPLATE_PLACEHOLDER =
  "Bonjour {firstName}, c'est {adminFirstName} de {shopName}.";

/**
 * Rend un modèle en substituant les variables. Les tokens inconnus sont
 * conservés tels quels (voir doc de `interpolate`) — safeguard visuel si la
 * cliente tape une variable mal orthographiée.
 */
export function renderWhatsAppMessage(
  template: string,
  ctx: WhatsAppMergeContext,
): string {
  return interpolate(template, ctx);
}

/**
 * Contexte d'aperçu pour l'éditeur — un client fictif « Marie Dupont /
 * Boutique de Marie » + les infos réelles de la boutique passées en
 * override. Utilisé dans le drawer d'édition et sur la fiche du modèle.
 */
export function buildWhatsAppPreviewContext(overrides?: Partial<Record<string, string>>): WhatsAppMergeContext {
  const ctx: WhatsAppMergeContext = {};
  for (const v of WHATSAPP_VARIABLES) {
    ctx[v.token] = v.previewValue;
  }
  if (overrides) {
    for (const [k, v] of Object.entries(overrides)) {
      if (typeof v === "string" && v.trim()) ctx[k] = v;
    }
  }
  return ctx;
}

/**
 * Construit l'URL WhatsApp cliquable. Vide → wa.me sans query, sinon
 * wa.me?text=… URL-encodé.
 *
 * Attention : WhatsApp Desktop décode mal les octets UTF-8 des emojis via
 * `?text=` (👋 → �). Pour éviter ce piège, la saisie des emojis est
 * bloquée en amont dans le schéma de validation des modèles
 * (`whatsAppTemplateSchema`).
 */
export function buildWhatsAppUrl(waNumber: string, renderedMessage?: string): string {
  const base = `https://wa.me/${waNumber}`;
  if (!renderedMessage || !renderedMessage.trim()) return base;
  return `${base}?text=${encodeURIComponent(renderedMessage.trim())}`;
}
