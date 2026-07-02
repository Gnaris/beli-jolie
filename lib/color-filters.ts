export type ColorForFilters = {
  id: string;
  name: string;
  translations: Record<string, string>;
  pfsColorRef: string | null;
  efashionColorId: number | null;
};

export type ColorFilterKey =
  | "missingTranslation"
  | "missingPfs"
  | "missingEfashion";

export function matchesSearch(color: ColorForFilters, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  if (color.name.toLowerCase().includes(q)) return true;
  for (const v of Object.values(color.translations)) {
    if (v && v.toLowerCase().includes(q)) return true;
  }
  return false;
}

export function matchesFilters(color: ColorForFilters, active: Set<ColorFilterKey>): boolean {
  if (active.size === 0) return true;
  if (active.has("missingTranslation")) {
    const fr = color.translations.fr;
    const en = color.translations.en;
    if (fr && fr.trim() !== "" && en && en.trim() !== "") return false;
  }
  if (active.has("missingPfs") && color.pfsColorRef && color.pfsColorRef.trim() !== "") return false;
  if (active.has("missingEfashion") && color.efashionColorId != null) return false;
  return true;
}

export function countMissing(list: ColorForFilters[], key: ColorFilterKey): number {
  return list.filter((c) => matchesFilters(c, new Set([key]))).length;
}
