/**
 * Comptage facetté pour la barre de filtres publique.
 *
 * Alimente le composant SearchFilters avec le nombre de produits qui
 * correspondraient à chaque option (catégorie, sous-cat, couleur, tag, compo,
 * toggles) étant donné les filtres actuellement appliqués, en respectant la
 * sémantique faceted-search standard : pour une dimension D, on applique
 * tous les filtres SAUF ceux de D (sinon la case qu'on vient de cocher
 * resterait toujours affichée à son propre count — comportement non prédictif).
 *
 * Toutes les opérations sont en mémoire — l'appelant fournit une projection
 * légère de tous les produits visibles (sans pagination) et le résultat sert
 * à griser les options avec count=0 côté UI.
 */

export type ProductFilterSummary = {
  id: string;
  reference: string;
  name: string;
  categoryId: string | null;
  subCategoryIds: string[];
  tagIds: string[];
  compositionIds: string[];
  colorIds: string[];
  minUnitPrice: number;
  isBestSeller: boolean;
  isTrending: boolean;
  discountPercent: number;
  createdAt: Date;
  lastRefreshedAt: Date | null;
};

export type FilterState = {
  q: string;
  exactRef: boolean;
  cat: string;
  subcat: string;
  colorIds: string[];
  tagId: string;
  compositionId: string;
  minPrice: number | null;
  maxPrice: number | null;
  bestseller: boolean;
  trending: boolean;
  isNew: boolean;
  promo: boolean;
  ordered: boolean;
  notOrdered: boolean;
};

export type FilterCounts = {
  categories: Record<string, number>;
  subCategories: Record<string, number>;
  colors: Record<string, number>;
  tags: Record<string, number>;
  compositions: Record<string, number>;
  bestseller: number;
  trending: number;
  isNew: number;
  promo: number;
  ordered: number;
  notOrdered: number;
};

type OmitKey =
  | "cat"
  | "subcat"
  | "color"
  | "tag"
  | "composition"
  | "bestseller"
  | "trending"
  | "new"
  | "promo"
  | "ordered"
  | "notOrdered";

const NEW_WINDOW_MS = 30 * 24 * 60 * 60 * 1000;

function matchesExceptOmitted(
  p: ProductFilterSummary,
  state: FilterState,
  omit: Set<OmitKey>,
  userOrderedRefs: Set<string>,
): boolean {
  // Recherche texte (toujours appliquée — pas de dim dédiée dans la sidebar
  // de counts, le champ texte n'est pas une facette).
  if (state.q) {
    if (state.exactRef) {
      if (p.reference.toUpperCase() !== state.q.toUpperCase()) return false;
    } else {
      const needle = state.q.toLowerCase();
      const matchRef = p.reference.toLowerCase().includes(needle);
      const matchName = p.name.toLowerCase().includes(needle);
      if (!matchRef && !matchName) return false;
    }
  }

  if (!omit.has("cat") && state.cat && p.categoryId !== state.cat) return false;
  if (!omit.has("subcat") && state.subcat && !p.subCategoryIds.includes(state.subcat)) return false;
  if (!omit.has("color") && state.colorIds.length > 0) {
    if (!state.colorIds.some((cid) => p.colorIds.includes(cid))) return false;
  }
  if (!omit.has("tag") && state.tagId && !p.tagIds.includes(state.tagId)) return false;
  if (!omit.has("composition") && state.compositionId && !p.compositionIds.includes(state.compositionId)) return false;

  // Prix : toujours appliqué, pas de facette dédiée pour les ranges numériques.
  if (state.minPrice !== null && p.minUnitPrice < state.minPrice) return false;
  if (state.maxPrice !== null && p.minUnitPrice > state.maxPrice) return false;

  if (!omit.has("bestseller") && state.bestseller && !p.isBestSeller) return false;
  if (!omit.has("trending") && state.trending && !p.isTrending) return false;
  if (!omit.has("new") && state.isNew) {
    const refreshed = p.lastRefreshedAt?.getTime() ?? 0;
    const created = p.createdAt.getTime();
    if (Math.max(created, refreshed) < Date.now() - NEW_WINDOW_MS) return false;
  }
  if (!omit.has("promo") && state.promo && p.discountPercent <= 0) return false;
  if (!omit.has("ordered") && state.ordered && !userOrderedRefs.has(p.reference)) return false;
  if (!omit.has("notOrdered") && state.notOrdered && userOrderedRefs.has(p.reference)) return false;

  return true;
}

export function computeFilterCounts(
  products: ProductFilterSummary[],
  state: FilterState,
  userOrderedRefsArr: string[],
): FilterCounts {
  const userOrderedRefs = new Set(userOrderedRefsArr);
  const now = Date.now();

  const categories: Record<string, number> = {};
  const subCategories: Record<string, number> = {};
  const colors: Record<string, number> = {};
  const tags: Record<string, number> = {};
  const compositions: Record<string, number> = {};
  let bestseller = 0;
  let trending = 0;
  let isNew = 0;
  let promo = 0;
  let ordered = 0;
  let notOrdered = 0;

  // Omit sets réutilisés (évite d'allouer un Set à chaque produit).
  const omitCat = new Set<OmitKey>(["cat", "subcat"]);
  const omitSubcat = new Set<OmitKey>(["subcat"]);
  const omitColor = new Set<OmitKey>(["color"]);
  const omitTag = new Set<OmitKey>(["tag"]);
  const omitCompo = new Set<OmitKey>(["composition"]);
  const omitBest = new Set<OmitKey>(["bestseller"]);
  const omitTrend = new Set<OmitKey>(["trending"]);
  const omitNew = new Set<OmitKey>(["new"]);
  const omitPromo = new Set<OmitKey>(["promo"]);
  const omitOrdered = new Set<OmitKey>(["ordered"]);
  const omitNotOrdered = new Set<OmitKey>(["notOrdered"]);

  for (const p of products) {
    // Catégories : omit cat + subcat (hiérarchique).
    if (p.categoryId && matchesExceptOmitted(p, state, omitCat, userOrderedRefs)) {
      categories[p.categoryId] = (categories[p.categoryId] ?? 0) + 1;
    }
    // Sous-catégories : omit subcat seul (garde cat).
    if (p.subCategoryIds.length > 0 && matchesExceptOmitted(p, state, omitSubcat, userOrderedRefs)) {
      for (const sc of p.subCategoryIds) subCategories[sc] = (subCategories[sc] ?? 0) + 1;
    }
    // Couleurs.
    if (p.colorIds.length > 0 && matchesExceptOmitted(p, state, omitColor, userOrderedRefs)) {
      for (const c of p.colorIds) colors[c] = (colors[c] ?? 0) + 1;
    }
    // Tags.
    if (p.tagIds.length > 0 && matchesExceptOmitted(p, state, omitTag, userOrderedRefs)) {
      for (const tid of p.tagIds) tags[tid] = (tags[tid] ?? 0) + 1;
    }
    // Compositions.
    if (p.compositionIds.length > 0 && matchesExceptOmitted(p, state, omitCompo, userOrderedRefs)) {
      for (const cid of p.compositionIds) compositions[cid] = (compositions[cid] ?? 0) + 1;
    }
    // Toggles.
    if (p.isBestSeller && matchesExceptOmitted(p, state, omitBest, userOrderedRefs)) bestseller++;
    if (p.isTrending && matchesExceptOmitted(p, state, omitTrend, userOrderedRefs)) trending++;
    if (matchesExceptOmitted(p, state, omitNew, userOrderedRefs)) {
      const refreshed = p.lastRefreshedAt?.getTime() ?? 0;
      const created = p.createdAt.getTime();
      if (Math.max(created, refreshed) >= now - NEW_WINDOW_MS) isNew++;
    }
    if (p.discountPercent > 0 && matchesExceptOmitted(p, state, omitPromo, userOrderedRefs)) promo++;
    if (userOrderedRefs.has(p.reference) && matchesExceptOmitted(p, state, omitOrdered, userOrderedRefs)) ordered++;
    if (!userOrderedRefs.has(p.reference) && matchesExceptOmitted(p, state, omitNotOrdered, userOrderedRefs)) notOrdered++;
  }

  return { categories, subCategories, colors, tags, compositions, bestseller, trending, isNew, promo, ordered, notOrdered };
}
