export type CountryForFilters = {
  id: string;
  name: string;
  isoCode: string | null;
  pfsCountryRef: string | null;
  efashionProvenanceId: number | null | undefined;
  faireCountryCode: string | null | undefined;
  productCount: number;
  translations: Record<string, string>;
};

export type CountryFilterKey =
  | "missingIso"
  | "missingTranslation"
  | "missingMapping"
  | "unused";

export function matchesSearch(item: CountryForFilters, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  if (item.name.toLowerCase().includes(q)) return true;
  if (item.isoCode && item.isoCode.toLowerCase().includes(q)) return true;
  for (const t of Object.values(item.translations)) {
    if (t.toLowerCase().includes(q)) return true;
  }
  return false;
}

function hasAnyMapping(item: CountryForFilters): boolean {
  return (
    !!(item.pfsCountryRef && item.pfsCountryRef.trim()) ||
    item.efashionProvenanceId != null ||
    !!(item.faireCountryCode && item.faireCountryCode.trim())
  );
}

export function matchesFilters(
  item: CountryForFilters,
  active: Set<CountryFilterKey>,
): boolean {
  if (active.size === 0) return true;
  if (active.has("missingIso") && item.isoCode && item.isoCode.trim() !== "") return false;
  if (
    active.has("missingTranslation") &&
    Object.keys(item.translations).length > 0
  ) {
    return false;
  }
  if (active.has("missingMapping") && hasAnyMapping(item)) return false;
  if (active.has("unused") && item.productCount > 0) return false;
  return true;
}

export function countMissing(
  list: CountryForFilters[],
  key: CountryFilterKey,
): number {
  return list.filter((c) => matchesFilters(c, new Set([key]))).length;
}
