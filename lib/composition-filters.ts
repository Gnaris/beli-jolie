export type CompositionForFilters = {
  id: string;
  name: string;
  translations: Record<string, string>;
  pfsCompositionRef: string | null;
  efashionId: number | null;
};

export type CompositionFilterKey =
  | "missingTranslation"
  | "missingPfs"
  | "missingEfashion";

export function matchesSearch(comp: CompositionForFilters, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  if (comp.name.toLowerCase().includes(q)) return true;
  for (const v of Object.values(comp.translations)) {
    if (v && v.toLowerCase().includes(q)) return true;
  }
  return false;
}

export function matchesFilters(comp: CompositionForFilters, active: Set<CompositionFilterKey>): boolean {
  if (active.size === 0) return true;
  if (active.has("missingTranslation")) {
    const fr = comp.translations.fr;
    const en = comp.translations.en;
    if (fr && fr.trim() !== "" && en && en.trim() !== "") return false;
  }
  if (active.has("missingPfs") && comp.pfsCompositionRef && comp.pfsCompositionRef.trim() !== "") return false;
  if (active.has("missingEfashion") && comp.efashionId != null) return false;
  return true;
}

export function countMissing(list: CompositionForFilters[], key: CompositionFilterKey): number {
  return list.filter((c) => matchesFilters(c, new Set([key]))).length;
}

/**
 * Initiales affichées dans le badge doré (Ac, La, Or…). On prend les 2 premières
 * lettres significatives du nom : première majuscule, seconde minuscule.
 */
export function compositionInitials(name: string): string {
  const clean = name.trim();
  if (!clean) return "?";
  const first = clean[0]?.toUpperCase() ?? "";
  const rest = clean.slice(1).replace(/[^a-zA-ZÀ-ÿ]/g, "");
  const second = rest[0]?.toLowerCase() ?? "";
  return `${first}${second}`;
}
