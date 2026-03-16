import { getRequestConfig } from "next-intl/server";
import { cookies } from "next/headers";

export const VALID_LOCALES = ["fr", "en", "ar", "zh", "de", "es", "it"] as const;
export type Locale = (typeof VALID_LOCALES)[number];
export const RTL_LOCALES: Locale[] = ["ar"];

function isValidLocale(locale: string): locale is Locale {
  return VALID_LOCALES.includes(locale as Locale);
}

export default getRequestConfig(async () => {
  const cookieStore = await cookies();
  const raw = cookieStore.get("bj_locale")?.value ?? "fr";
  const locale: Locale = isValidLocale(raw) ? raw : "fr";

  return {
    locale,
    messages: (await import(`../messages/${locale}.json`)).default,
  };
});
