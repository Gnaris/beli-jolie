/**
 * Résolution de la langue d'envoi d'un mail à partir du pays du destinataire.
 *
 * Règle produit figée avec la cliente (2026-10-07) :
 *   - France métropolitaine + DOM-TOM + Belgique + Luxembourg + Monaco + Suisse
 *     + Andorre → FR (par défaut).
 *   - Allemagne + Autriche → DE.
 *   - Espagne → ES.
 *   - Italie → IT.
 *   - Tout le reste → EN.
 *
 * À l'envoi, si la version dans la langue cible est vide côté admin, la
 * cascade de secours est : locale cible → EN → FR (jamais d'envoi vide).
 *
 * Module pur — pas d'accès BDD ici, uniquement un code ISO 3166-1 alpha-2
 * en entrée (ex: `"FR"`, `"de"`, `null`).
 */

export const MAIL_LOCALES = ["fr", "en", "de", "es", "it"] as const;
export type MailLocale = (typeof MAIL_LOCALES)[number];

/** Langue par défaut quand on ne sait pas (compte sans pays, pays inconnu). */
export const DEFAULT_MAIL_LOCALE: MailLocale = "fr";

/** Cascade de secours quand la version choisie est vide. Jamais d'envoi vide. */
export const MAIL_LOCALE_FALLBACK: readonly MailLocale[] = ["en", "fr"] as const;

/** Pays francophones (incluant Belgique, Luxembourg, Monaco, Suisse, Andorre). */
const FR_COUNTRIES = new Set([
  "FR",
  "BE",
  "LU",
  "MC",
  "CH",
  "AD",
  // DOM-TOM : Guadeloupe, Martinique, Guyane, Réunion, Mayotte, Saint-Pierre-et-Miquelon,
  // Saint-Barthélemy, Saint-Martin, Wallis-et-Futuna, Polynésie française,
  // Nouvelle-Calédonie, Terres australes françaises.
  "GP",
  "MQ",
  "GF",
  "RE",
  "YT",
  "PM",
  "BL",
  "MF",
  "WF",
  "PF",
  "NC",
  "TF",
]);

const DE_COUNTRIES = new Set(["DE", "AT"]);
const ES_COUNTRIES = new Set(["ES"]);
const IT_COUNTRIES = new Set(["IT"]);

/**
 * Renvoie la langue d'envoi pour un pays donné (code ISO alpha-2, insensible
 * à la casse). `null` ou pays non reconnu → `"en"` (sauf si on considère que
 * sans info on retombe en FR, défaut historique du site). Choix produit :
 * on reste strict sur « code reconnu = langue mappée, sinon anglais » pour
 * ne pas envoyer un mail français à un client allemand mal renseigné.
 *
 * Pays `null` : la cliente peut avoir des contacts sans adresse — on garde
 * `DEFAULT_MAIL_LOCALE` (FR) pour ne pas basculer tout l'historique France en
 * anglais à cause d'une donnée manquante.
 */
export function resolveLocaleFromCountry(countryIso: string | null | undefined): MailLocale {
  if (!countryIso) return DEFAULT_MAIL_LOCALE;
  const code = countryIso.trim().toUpperCase();
  if (code.length === 0) return DEFAULT_MAIL_LOCALE;
  if (FR_COUNTRIES.has(code)) return "fr";
  if (DE_COUNTRIES.has(code)) return "de";
  if (ES_COUNTRIES.has(code)) return "es";
  if (IT_COUNTRIES.has(code)) return "it";
  return "en";
}

/**
 * À partir d'un objet `{ locale → { subject, html } }` et d'une langue cible,
 * renvoie la 1ʳᵉ version non-vide en descendant la cascade de secours :
 *   langue cible → EN → FR.
 * Retourne `null` si toutes les versions sont vides (ne devrait jamais arriver
 * en pratique : FR est obligatoire côté UI avant sauvegarde).
 */
export function pickLocaleContent(
  byLocale: Partial<Record<MailLocale, { subject: string; html: string | null }>>,
  target: MailLocale,
): { locale: MailLocale; subject: string; html: string } | null {
  const order: MailLocale[] = [target, ...MAIL_LOCALE_FALLBACK.filter((l) => l !== target)];
  for (const l of order) {
    const entry = byLocale[l];
    if (!entry) continue;
    const html = entry.html?.trim() ?? "";
    const subject = entry.subject?.trim() ?? "";
    if (html.length > 0 && subject.length > 0) {
      return { locale: l, subject: entry.subject, html: entry.html ?? "" };
    }
  }
  return null;
}
