import { getRequestConfig } from "next-intl/server";
import { cookies } from "next/headers";
import { VALID_LOCALES, type Locale } from "./locales";

export { VALID_LOCALES, LOCALE_LABELS, LOCALE_FULL_NAMES, RTL_LOCALES } from "./locales";
export type { Locale } from "./locales";

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
