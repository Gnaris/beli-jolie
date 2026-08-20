export type CategoryForFilters = {
  id: string;
  name: string;
  translations: Record<string, string>;
  pfsCategoryId: string | null;
  pfsGender: string | null;
  pfsFamilyName: string | null;
  pfsCategoryName: string | null;
  efashionCategorieId: number | null;
  faireTaxonomyId: string | null;
  orderchampCategoryPath: string | null;
};

// Une catégorie est considérée mappée PFS dès que les 3 champs texte sont
// remplis (Genre + Famille + Catégorie). L'ID Salesforce pfsCategoryId est
// résolu automatiquement lors du 1er push PFS ; ne pas l'exiger sinon toute
// catégorie mappée à la main via la modale apparaît comme « sans lien PFS ».
function hasPfsMapping(cat: CategoryForFilters): boolean {
  return (
    !!cat.pfsGender &&
    !!cat.pfsFamilyName?.trim() &&
    !!cat.pfsCategoryName?.trim()
  );
}

export type FilterKey =
  | "missingTranslation"
  | "missingPfs"
  | "missingEfashion"
  | "missingFaire"
  | "missingOrderchamp";

export function matchesSearch(cat: CategoryForFilters, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  if (cat.name.toLowerCase().includes(q)) return true;
  for (const v of Object.values(cat.translations)) {
    if (v && v.toLowerCase().includes(q)) return true;
  }
  return false;
}

export function matchesFilters(cat: CategoryForFilters, active: Set<FilterKey>): boolean {
  if (active.size === 0) return true;
  if (active.has("missingTranslation")) {
    const fr = cat.translations.fr;
    const en = cat.translations.en;
    if (fr && fr.trim() !== "" && en && en.trim() !== "") return false;
  }
  if (active.has("missingPfs") && hasPfsMapping(cat)) return false;
  if (active.has("missingEfashion") && cat.efashionCategorieId != null) return false;
  if (active.has("missingFaire") && cat.faireTaxonomyId != null) return false;
  if (active.has("missingOrderchamp") && cat.orderchampCategoryPath != null) return false;
  return true;
}

export function countMissing(list: CategoryForFilters[], key: FilterKey): number {
  return list.filter((c) => matchesFilters(c, new Set([key]))).length;
}
