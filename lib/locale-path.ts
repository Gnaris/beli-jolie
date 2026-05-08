import { VALID_LOCALES, type Locale } from "@/i18n/locales";

/**
 * Retire le préfixe de locale (`/fr`, `/en`, …) en début de chemin s'il y en a un.
 * Garantit que la valeur passée ensuite à `router.replace(path, { locale })` n'a
 * plus de préfixe — sans ça on produit des URLs invalides comme `/en/en/produits`
 * quand `usePathname` n'a pas pu (encore) stripper le préfixe lui-même.
 */
export function stripLocalePrefix(pathname: string): string {
  for (const l of VALID_LOCALES) {
    if (pathname === `/${l}`) return "/";
    if (pathname.startsWith(`/${l}/`)) return pathname.slice(l.length + 1);
  }
  return pathname;
}

/** Renvoie la locale présente en début d'URL si elle y figure, sinon `null`. */
export function detectLocaleInPath(pathname: string): Locale | null {
  for (const l of VALID_LOCALES) {
    if (pathname === `/${l}` || pathname.startsWith(`/${l}/`)) return l;
  }
  return null;
}
