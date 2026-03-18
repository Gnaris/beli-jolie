export const VALID_LOCALES = ["fr", "en", "ar", "zh", "de", "es", "it"] as const;
export type Locale = (typeof VALID_LOCALES)[number];
export const RTL_LOCALES: Locale[] = ["ar"];

export const LOCALE_LABELS: Record<string, string> = {
  fr: "FR",
  en: "EN",
  ar: "AR",
  zh: "中文",
  de: "DE",
  es: "ES",
  it: "IT",
};

/** Full language names in French — used in creation modals */
export const LOCALE_FULL_NAMES: Record<string, string> = {
  fr: "Français",
  en: "Anglais",
  ar: "Arabe",
  zh: "Chinois (simplifié)",
  de: "Allemand",
  es: "Espagnol",
  it: "Italien",
};
