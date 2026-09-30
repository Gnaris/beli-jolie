/**
 * Résolveur de langue pour l'envoi WhatsApp.
 *
 * Chaque client a un champ `User.addressCountry` en code ISO-2 (ex. "FR",
 * "BE", "GP", "US"). Un modèle WhatsApp stocke deux versions du corps :
 *   - `body`   (français, source)
 *   - `bodyEn` (anglais, auto-traduit)
 *
 * Cette lib décide laquelle envoyer :
 *   - Pays francophone (ou pays inconnu) → français.
 *   - Sinon → anglais si dispo, sinon fallback français.
 *
 * La liste couvre la France métropolitaine, les DOM-TOM, et les voisins
 * francophones naturels de la boutique (BE, CH, LU, MC). Elle N'INCLUT PAS
 * l'ensemble des pays officiellement francophones (Maghreb, Afrique de
 * l'Ouest, Québec…) : la cliente préfère y envoyer de l'anglais qui est
 * lu partout en business, plutôt qu'un français mal ciblé.
 *
 * Module pur — 0 dépendance serveur, safe pour import côté client.
 */

/**
 * Pays / territoires qui reçoivent le message en français.
 * Set pour lookup O(1) et éviter les doublons accidentels.
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

export type WhatsAppLocale = "fr" | "en";

/**
 * Choisit la locale d'envoi à partir du pays du destinataire.
 *
 * Règles :
 *   - Pays vide, null, ou espaces uniquement → "fr" (par prudence — on n'envoie
 *     pas un texte étranger à quelqu'un dont on ne connaît pas le pays).
 *   - Pays présent dans la liste francophone (insensible à la casse) → "fr".
 *   - Sinon → "en".
 */
export function resolveWhatsAppLocale(country?: string | null): WhatsAppLocale {
  if (!country) return "fr";
  const code = country.trim().toUpperCase();
  if (code.length === 0) return "fr";
  return FRANCOPHONE_COUNTRY_CODES.has(code) ? "fr" : "en";
}

/**
 * Choisit le corps de message à rendre en fonction de la locale et de la
 * disponibilité de la version anglaise. Si l'anglais est vide (trad échouée
 * ou modèle historique jamais retraduit), on retombe sur le français —
 * la cliente préfère envoyer du FR à un client anglophone plutôt que rien.
 */
export function pickWhatsAppBody(input: {
  locale: WhatsAppLocale;
  bodyFr: string;
  bodyEn: string | null | undefined;
}): { body: string; sentLocale: WhatsAppLocale } {
  if (input.locale === "en" && input.bodyEn && input.bodyEn.trim().length > 0) {
    return { body: input.bodyEn, sentLocale: "en" };
  }
  return { body: input.bodyFr, sentLocale: "fr" };
}
