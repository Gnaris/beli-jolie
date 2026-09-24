import { translateProduct } from "@/lib/product-translations";

/**
 * Résout le nom affiché dans la locale courante pour un produit, une catégorie
 * ou une couleur :
 *   - locale `fr` → texte brut BDD
 *   - autres locales → traduction saisie par l'admin (ProductTranslation /
 *     CategoryTranslation / ColorTranslation) si présente ; sinon fallback
 *     dictionnaire FR→EN pour rester rétro-compatible avec les entités qui
 *     n'ont jamais été traduites.
 */
export function resolveLocalizedName(
  raw: string | null | undefined,
  translations: { name: string }[] | undefined,
  locale: string
): string {
  const source = raw ?? "";
  if (locale === "fr") return source;
  const dbName = translations?.[0]?.name?.trim();
  if (dbName) return dbName;
  return translateProduct(source, locale);
}
