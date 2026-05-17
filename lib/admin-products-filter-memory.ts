/**
 * Mémorise les filtres de la page /admin/produits dans sessionStorage afin
 * que l'admin retrouve sa vue filtrée en revenant sur la liste depuis une
 * fiche produit ou un autre écran.
 *
 * Logique testable, sans dépendance React/Next.
 */

export const ADMIN_PRODUCTS_FILTERS_STORAGE_KEY = "admin-products-filters-v1";

/**
 * Toutes les clés de query string considérées comme "état de la liste produits".
 * Inclut pagination (page/perPage) pour retrouver exactement la même vue.
 * Volontairement hors liste : `tab` (onglet Catégories/Couleurs/etc.), `refresh`
 * de force, et tout ce qui n'est pas un filtre persistant.
 */
export const ADMIN_PRODUCTS_FILTER_KEYS = [
  "q",
  "exactRef",
  "cat",
  "subCat",
  "tag",
  "composition",
  "bestSeller",
  "refresh",
  "status",
  "minPrice",
  "maxPrice",
  "dateFrom",
  "dateTo",
  "stockBelow",
  "missingImages",
  "pfsLink",
  "ankorsLink",
  "page",
  "perPage",
] as const;

/**
 * Extrait, depuis une query string complète, uniquement les paramètres
 * de filtres/pagination de la liste produits. Retourne une chaîne sérialisée
 * prête à être stockée (ou `""` si aucun filtre n'est présent).
 */
export function extractFiltersQueryString(searchParamsString: string): string {
  const source = new URLSearchParams(searchParamsString);
  const out = new URLSearchParams();
  for (const key of ADMIN_PRODUCTS_FILTER_KEYS) {
    const value = source.get(key);
    if (value) out.set(key, value);
  }
  return out.toString();
}

/** Vrai si la query string courante contient au moins un filtre persistable. */
export function hasAnyFilter(searchParamsString: string): boolean {
  return extractFiltersQueryString(searchParamsString).length > 0;
}

interface SessionStorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

/**
 * Sauvegarde les filtres courants si présents, ou ne fait rien sinon
 * (l'absence de filtres n'écrase pas la mémoire — sinon un simple
 * `router.push("/admin/produits")` viderait tout).
 */
export function saveFilters(
  searchParamsString: string,
  storage: SessionStorageLike,
): void {
  const qs = extractFiltersQueryString(searchParamsString);
  if (qs.length > 0) {
    try {
      storage.setItem(ADMIN_PRODUCTS_FILTERS_STORAGE_KEY, qs);
    } catch {
      // sessionStorage indisponible (mode privé Safari, quota plein) → on ignore
    }
  }
}

/**
 * Retourne la query string mémorisée si l'URL courante n'a aucun filtre et
 * qu'une mémorisation existe. Sinon `null` (rien à restaurer).
 */
export function loadFiltersToRestore(
  searchParamsString: string,
  storage: SessionStorageLike,
): string | null {
  if (hasAnyFilter(searchParamsString)) return null;
  try {
    const saved = storage.getItem(ADMIN_PRODUCTS_FILTERS_STORAGE_KEY);
    if (saved && saved.length > 0) return saved;
  } catch {
    // ignore
  }
  return null;
}

/** Efface la mémoire (à appeler depuis le bouton "Effacer les filtres"). */
export function clearFilters(storage: SessionStorageLike): void {
  try {
    storage.removeItem(ADMIN_PRODUCTS_FILTERS_STORAGE_KEY);
  } catch {
    // ignore
  }
}
