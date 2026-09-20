/**
 * Résolution côté serveur des noms traduits utilisés sur la page d'accueil.
 *
 * Priorité pour chaque nom (Category / Collection / Product) :
 *   1. Enregistrement explicite dans `*Translation` (locale = target) — écrit
 *      par l'auto-traduction PFS ou l'admin.
 *   2. Dictionnaire client-side (`lib/product-translations.ts`) — couvre les
 *      termes bijoux courants (« Collier » → « Necklace », etc.).
 *   3. Nom français d'origine si rien ne matche.
 *
 * Le layout Issyma inline le rendu des catégories / collections / produits et
 * n'a pas de hook client équivalent à `useProductTranslation` — d'où cette
 * pré-résolution côté serveur AVANT le rendu du layout.
 */
import { prisma } from "@/lib/prisma";
import { translateProduct } from "@/lib/product-translations";
import { DEFAULT_LOCALE } from "@/i18n/locales";

/**
 * Charge les traductions DB pour un ensemble de noms français. Retourne une
 * map `frenchName.toLowerCase() → translatedName`. Une clé absente signifie
 * pas de traduction DB → fallback dictionnaire.
 */
async function loadLookup(
  fetcher: (names: string[]) => Promise<Array<{ name: string; translations: { name: string }[] }>>,
  frenchNames: string[],
): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  const unique = Array.from(new Set(frenchNames.filter((n) => n && n.trim().length > 0)));
  if (unique.length === 0) return map;
  const rows = await fetcher(unique);
  for (const r of rows) {
    const translated = r.translations?.[0]?.name?.trim();
    if (translated && translated !== r.name) {
      map.set(r.name.toLowerCase(), translated);
    }
  }
  return map;
}

/** Ce dont a besoin la home pour appeler `loadHomeTranslationLookups`. */
export interface HomeTranslationInput {
  categoryNames: string[];
  subCategoryNames: string[];
  collectionNames: string[];
  productNames: string[];
}

/**
 * Charge en parallèle les traductions DB pour toutes les entités affichées
 * sur la home. Locale par défaut → maps vides (rien à traduire).
 */
export async function loadHomeTranslationLookups(
  locale: string,
  input: HomeTranslationInput,
): Promise<HomeTranslationLookups> {
  if (locale === DEFAULT_LOCALE) {
    return {
      categories: new Map(),
      subCategories: new Map(),
      collections: new Map(),
      products: new Map(),
    };
  }

  const [categories, subCategories, collections, products] = await Promise.all([
    loadLookup(
      (names) =>
        prisma.category.findMany({
          where: { name: { in: names } },
          select: { name: true, translations: { where: { locale }, select: { name: true }, take: 1 } },
        }),
      input.categoryNames,
    ),
    loadLookup(
      (names) =>
        prisma.subCategory.findMany({
          where: { name: { in: names } },
          select: { name: true, translations: { where: { locale }, select: { name: true }, take: 1 } },
        }),
      input.subCategoryNames,
    ),
    loadLookup(
      (names) =>
        prisma.collection.findMany({
          where: { name: { in: names } },
          select: { name: true, translations: { where: { locale }, select: { name: true }, take: 1 } },
        }),
      input.collectionNames,
    ),
    loadLookup(
      (names) =>
        prisma.product.findMany({
          where: { name: { in: names } },
          select: { name: true, translations: { where: { locale }, select: { name: true }, take: 1 } },
        }),
      input.productNames,
    ),
  ]);

  return { categories, subCategories, collections, products };
}

export interface HomeTranslationLookups {
  categories: Map<string, string>;
  subCategories: Map<string, string>;
  collections: Map<string, string>;
  products: Map<string, string>;
}

/**
 * Applique la résolution à un nom de catégorie / sous-catégorie.
 * Cascade : Category → SubCategory → dictionnaire → français d'origine.
 */
export function translateCategoryLike(
  name: string,
  locale: string,
  lookups: HomeTranslationLookups,
): string {
  if (locale === DEFAULT_LOCALE || !name) return name;
  const lower = name.toLowerCase();
  const fromCat = lookups.categories.get(lower) ?? lookups.subCategories.get(lower);
  if (fromCat) return fromCat;
  return translateProduct(name, locale) || name;
}

/** Nom de collection : DB → dictionnaire → français. */
export function translateCollectionName(
  name: string,
  locale: string,
  lookups: HomeTranslationLookups,
): string {
  if (locale === DEFAULT_LOCALE || !name) return name;
  const fromDb = lookups.collections.get(name.toLowerCase());
  if (fromDb) return fromDb;
  return translateProduct(name, locale) || name;
}

/** Nom de produit : DB → dictionnaire → français. */
export function translateProductName(
  name: string,
  locale: string,
  lookups: HomeTranslationLookups,
): string {
  if (locale === DEFAULT_LOCALE || !name) return name;
  const fromDb = lookups.products.get(name.toLowerCase());
  if (fromDb) return fromDb;
  return translateProduct(name, locale) || name;
}
