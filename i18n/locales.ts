export const VALID_LOCALES = ["fr", "en", "de", "it", "es"] as const;
export type Locale = (typeof VALID_LOCALES)[number];

/** Locale par défaut — utilisée pour x-default hreflang et fallback global. */
export const DEFAULT_LOCALE: Locale = "fr";

/** Locales other than the default `fr`. Used by server actions, batch helpers,
 *  and admin UI to enumerate the languages that need a translation. */
export const NON_DEFAULT_LOCALES: Locale[] = VALID_LOCALES.filter(
  (l): l is Exclude<Locale, "fr"> => l !== "fr"
) as Locale[];

/**
 * Locales ciblées par l'auto-traduction fire-and-forget (hook de création
 * d'entité quand `auto_translate_enabled=true`). Couvre toutes les locales
 * non-défaut : l'API PFS renvoie les 5 langues en 1 appel via `translatePhrases`,
 * donc étendre à EN/DE/IT/ES ne multiplie pas les requêtes. Les langues saisies
 * manuellement par l'admin (flag `manualEdit`) ne sont jamais écrasées.
 */
export const AUTO_TRANSLATE_LOCALES: Locale[] = NON_DEFAULT_LOCALES;

export const RTL_LOCALES: Locale[] = [];

export const LOCALE_LABELS: Record<string, string> = {
  fr: "FR",
  en: "EN",
  de: "DE",
  it: "IT",
  es: "ES",
};

/** Full language names in French — used in creation modals */
export const LOCALE_FULL_NAMES: Record<string, string> = {
  fr: "Français",
  en: "Anglais",
  de: "Allemand",
  it: "Italien",
  es: "Espagnol",
};
