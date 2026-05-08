export const VALID_LOCALES = ["fr", "en"] as const;
export type Locale = (typeof VALID_LOCALES)[number];

/** Locales other than the default `fr`. Used by server actions, batch helpers,
 *  and admin UI to enumerate the languages that need a translation. */
export const NON_DEFAULT_LOCALES: Locale[] = VALID_LOCALES.filter(
  (l): l is Exclude<Locale, "fr"> => l !== "fr"
) as Locale[];

export const RTL_LOCALES: Locale[] = [];

export const LOCALE_LABELS: Record<string, string> = {
  fr: "FR",
  en: "EN",
};

/** Full language names in French — used in creation modals */
export const LOCALE_FULL_NAMES: Record<string, string> = {
  fr: "Français",
  en: "Anglais",
};
