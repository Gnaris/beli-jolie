/**
 * Types + helpers purs pour la taxonomie Faire — séparés de `faire-taxonomy.ts`
 * pour permettre l'import depuis des composants client (qui ne doivent pas
 * tirer `next/cache` / `faire-api` / Prisma dans le bundle navigateur).
 */

/** Public cible — utilisé pour distinguer les `tt_xxx` qui partagent un même nom. */
export type FaireTargetCustomer =
  | "ALL_CUSTOMERS"
  | "ADULT_UNISEX"
  | "ADULT_WOMEN"
  | "ADULT_MEN"
  | "KIDS_AND_BABY_UNISEX"
  | "BABY_UNISEX"
  | string;

export interface FaireTaxonomyType {
  id: string;
  name: string;
  /** Nom "propre" (humain) — souvent au pluriel ("Bracelets" vs "Bracelet"). */
  cleanName?: string;
  /**
   * Chemin de catégorie sous forme `["Bijoux", "Bracelets"]`. Permet à l'UI
   * d'afficher un breadcrumb pour aider la cliente à choisir le bon `tt_xxx`.
   */
  categoryBreadcrumb?: string[];
  targetCustomer?: FaireTargetCustomer;
}

function normalizeForSearch(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .trim();
}

/**
 * Recherche fuzzy dans la taxonomie chargée. Match sur `name` + `cleanName` +
 * dernière entrée du breadcrumb. Tri : exact > préfixe > inclusion.
 */
export function searchFaireTaxonomy(
  types: FaireTaxonomyType[],
  query: string,
  limit = 20,
): FaireTaxonomyType[] {
  const q = normalizeForSearch(query);
  if (!q) return types.slice(0, limit);

  type Scored = { type: FaireTaxonomyType; score: number };
  const scored: Scored[] = [];

  for (const t of types) {
    const candidates = [
      t.name,
      t.cleanName ?? "",
      t.categoryBreadcrumb?.[t.categoryBreadcrumb.length - 1] ?? "",
    ]
      .map(normalizeForSearch)
      .filter(Boolean);

    let best = 0;
    for (const c of candidates) {
      if (c === q) best = Math.max(best, 100);
      else if (c.startsWith(q)) best = Math.max(best, 50);
      else if (c.includes(q)) best = Math.max(best, 20);
    }
    if (best > 0) scored.push({ type: t, score: best });
  }

  scored.sort((a, b) => b.score - a.score || a.type.name.localeCompare(b.type.name));
  return scored.slice(0, limit).map((s) => s.type);
}

/** Lookup direct par ID (tt_xxx) — retourne null si introuvable. */
export function findFaireTaxonomyById(
  types: FaireTaxonomyType[],
  id: string,
): FaireTaxonomyType | null {
  return types.find((t) => t.id === id) ?? null;
}
