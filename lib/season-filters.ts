export type SeasonForFilters = {
  id: string;
  name: string;
  translations: Record<string, string>;
  pfsRef: string | null;
  efashionCollectionId: number | null;
};

export type SeasonFilterKey =
  | "missingTranslation"
  | "missingPfs"
  | "missingEfashion";

export function matchesSearch(season: SeasonForFilters, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  if (season.name.toLowerCase().includes(q)) return true;
  for (const v of Object.values(season.translations)) {
    if (v && v.toLowerCase().includes(q)) return true;
  }
  if (season.pfsRef && season.pfsRef.toLowerCase().includes(q)) return true;
  return false;
}

export function matchesFilters(season: SeasonForFilters, active: Set<SeasonFilterKey>): boolean {
  if (active.size === 0) return true;
  if (active.has("missingTranslation")) {
    const fr = season.translations.fr;
    const en = season.translations.en;
    if (fr && fr.trim() !== "" && en && en.trim() !== "") return false;
  }
  if (active.has("missingPfs") && season.pfsRef && season.pfsRef.trim() !== "") return false;
  if (active.has("missingEfashion") && season.efashionCollectionId != null) return false;
  return true;
}

export function countMissing(list: SeasonForFilters[], key: SeasonFilterKey): number {
  return list.filter((s) => matchesFilters(s, new Set([key]))).length;
}

export function extractYear(name: string): number | null {
  const clean = name.trim();
  const full = /(?<![0-9])(20\d{2})(?![0-9])/.exec(clean);
  if (full) return Number(full[1]);
  const short = /(?<![0-9])([2-9]\d)(?![0-9])/.exec(clean);
  if (short) return 2000 + Number(short[1]);
  return null;
}

export function seasonEmoji(name: string): string {
  const n = name.toLowerCase();
  if (/\b(f[eê]tes?|noel|no[eë]l|christmas|holiday|holidays)\b/.test(n)) return "✨";
  if (/hiver|winter|automne|autumn|fall/.test(n)) return "🍂";
  if (/[eé]t[eé]|summer|printemps|spring/.test(n)) return "☀️";
  if (/toute\s?saison|intemporel|permanent|all\s?season|classic|essentiel/.test(n)) return "♾";
  return "✨";
}

export function seasonGradient(name: string): string {
  const emoji = seasonEmoji(name);
  switch (emoji) {
    case "☀️":
      return "linear-gradient(135deg, #FDE68A 0%, #F97316 100%)";
    case "🍂":
      return "linear-gradient(135deg, #FED7AA 0%, #C2410C 100%)";
    case "✨":
      return "linear-gradient(135deg, #DDD6FE 0%, #7C3AED 100%)";
    case "♾":
      return "linear-gradient(135deg, #A7F3D0 0%, #059669 100%)";
    default:
      return "linear-gradient(135deg, #E0F2FE 0%, #0284C7 100%)";
  }
}
