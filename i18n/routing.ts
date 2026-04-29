import { defineRouting } from "next-intl/routing";
import { VALID_LOCALES } from "./locales";

export const routing = defineRouting({
  locales: VALID_LOCALES,
  defaultLocale: "fr",
  // "always" = toutes les routes publiques sont préfixées (/fr/, /en/, etc.).
  // Les anciennes URLs sans préfixe sont redirigées en 301 vers la locale par défaut.
  localePrefix: "always",
  localeDetection: false,
});
