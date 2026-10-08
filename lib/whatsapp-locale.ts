/**
 * Résolveur de langue pour l'envoi WhatsApp — 5 locales (fr, en, de, it, es).
 *
 * Chaque client a un champ `User.addressCountry` en code ISO-2 (ex. "FR",
 * "DE", "AR", "US"). Un modèle WhatsApp stocke jusqu'à 5 versions du corps :
 *   - `body`    (français, source — toujours présent)
 *   - `bodyEn`  (anglais)
 *   - `bodyDe`  (allemand)
 *   - `bodyIt`  (italien)
 *   - `bodyEs`  (espagnol)
 *
 * Cette lib décide laquelle envoyer :
 *   - Pays francophone (ou pays inconnu) → français.
 *   - DE/AT                              → allemand.
 *   - IT / Saint-Marin / Vatican         → italien.
 *   - ES + Amérique latine hispanophone  → espagnol.
 *   - Sinon                              → anglais.
 *
 * Fallback à l'envoi : si la version ciblée est vide (cliente n'a pas
 * traduit), on retombe sur EN, puis sur FR en dernier recours. On préfère
 * envoyer un message dans la mauvaise langue qu'un message vide.
 *
 * Module pur — 0 dépendance serveur, safe pour import côté client.
 */

/**
 * Pays / territoires qui reçoivent le message en français.
 * Set pour lookup O(1) et éviter les doublons accidentels.
 *
 * La Suisse et la Belgique sont volontairement en français (choix cliente) —
 * elles parlent aussi d'autres langues mais ses contacts pros y sont
 * francophones.
 */
export const FRANCOPHONE_COUNTRY_CODES: ReadonlySet<string> = new Set([
  "FR", // France métropolitaine
  "BE", // Belgique
  "CH", // Suisse
  "LU", // Luxembourg
  "MC", // Monaco
  "GP", // Guadeloupe
  "MQ", // Martinique
  "GF", // Guyane française
  "RE", // La Réunion
  "YT", // Mayotte
  "PM", // Saint-Pierre-et-Miquelon
  "BL", // Saint-Barthélemy
  "MF", // Saint-Martin (partie française)
  "NC", // Nouvelle-Calédonie
  "PF", // Polynésie française
  "WF", // Wallis-et-Futuna
  "TF", // Terres australes et antarctiques françaises
]);

/** Pays germanophones. */
export const GERMANOPHONE_COUNTRY_CODES: ReadonlySet<string> = new Set([
  "DE", // Allemagne
  "AT", // Autriche
]);

/** Pays italophones. */
export const ITALOPHONE_COUNTRY_CODES: ReadonlySet<string> = new Set([
  "IT", // Italie
  "SM", // Saint-Marin
  "VA", // Cité du Vatican
]);

/**
 * Pays hispanophones — Espagne + Amérique latine hispanophone.
 * Brésil (BR, portugais) exclu — tombera sur anglais.
 */
export const HISPANOPHONE_COUNTRY_CODES: ReadonlySet<string> = new Set([
  "ES", // Espagne
  "MX", // Mexique
  "AR", // Argentine
  "CO", // Colombie
  "CL", // Chili
  "PE", // Pérou
  "VE", // Venezuela
  "EC", // Équateur
  "GT", // Guatemala
  "CU", // Cuba
  "BO", // Bolivie
  "DO", // République dominicaine
  "HN", // Honduras
  "PY", // Paraguay
  "SV", // Salvador
  "NI", // Nicaragua
  "CR", // Costa Rica
  "PA", // Panama
  "UY", // Uruguay
  "PR", // Porto Rico
  "GQ", // Guinée équatoriale
]);

export type WhatsAppLocale = "fr" | "en" | "de" | "it" | "es";

/**
 * Choisit la locale d'envoi à partir du pays du destinataire.
 *
 * Règles :
 *   - Pays vide, null, ou espaces uniquement → "fr" (par prudence — on n'envoie
 *     pas un texte étranger à quelqu'un dont on ne connaît pas le pays).
 *   - Pays présent dans une liste → sa locale (insensible à la casse).
 *   - Sinon → "en".
 */
export function resolveWhatsAppLocale(country?: string | null): WhatsAppLocale {
  if (!country) return "fr";
  const code = country.trim().toUpperCase();
  if (code.length === 0) return "fr";
  if (FRANCOPHONE_COUNTRY_CODES.has(code)) return "fr";
  if (GERMANOPHONE_COUNTRY_CODES.has(code)) return "de";
  if (ITALOPHONE_COUNTRY_CODES.has(code)) return "it";
  if (HISPANOPHONE_COUNTRY_CODES.has(code)) return "es";
  return "en";
}

/**
 * Bodies disponibles pour un modèle, par locale. `null`/`undefined`/vide =
 * absent (déclenche le fallback).
 */
export interface WhatsAppBodies {
  bodyFr: string;
  bodyEn?: string | null;
  bodyDe?: string | null;
  bodyIt?: string | null;
  bodyEs?: string | null;
}

/**
 * Choisit le corps de message à rendre en fonction de la locale et de la
 * disponibilité des traductions. Cascade :
 *   1. locale ciblée si non vide
 *   2. anglais si non vide
 *   3. français (toujours présent)
 */
export function pickWhatsAppBody(input: {
  locale: WhatsAppLocale;
  bodyFr: string;
  bodyEn?: string | null;
  bodyDe?: string | null;
  bodyIt?: string | null;
  bodyEs?: string | null;
}): { body: string; sentLocale: WhatsAppLocale } {
  const localized = pickBodyForLocale(input.locale, input);
  if (localized !== null) {
    return { body: localized, sentLocale: input.locale };
  }
  // Fallback 1 — anglais (sauf si on y a déjà échoué).
  if (input.locale !== "en") {
    const en = pickBodyForLocale("en", input);
    if (en !== null) {
      return { body: en, sentLocale: "en" };
    }
  }
  // Fallback 2 — français (toujours présent dans le schéma).
  return { body: input.bodyFr, sentLocale: "fr" };
}

function pickBodyForLocale(
  locale: WhatsAppLocale,
  bodies: WhatsAppBodies,
): string | null {
  const raw = bodyForLocale(locale, bodies);
  if (raw && raw.trim().length > 0) return raw;
  return null;
}

function bodyForLocale(
  locale: WhatsAppLocale,
  bodies: WhatsAppBodies,
): string | null | undefined {
  switch (locale) {
    case "fr":
      return bodies.bodyFr;
    case "en":
      return bodies.bodyEn;
    case "de":
      return bodies.bodyDe;
    case "it":
      return bodies.bodyIt;
    case "es":
      return bodies.bodyEs;
  }
}
