/**
 * Liste des pays supportés dans les fiches client admin.
 * Code ISO 3166-1 alpha-2 (2 lettres) + libellé FR.
 * Drapeau servi par https://flagcdn.com (PNG public, gratuit).
 */

export type CountryOption = {
  code: string; // ISO 3166-1 alpha-2 (ex. "FR")
  name: string; // Libellé FR
  nameEn?: string; // Libellé EN (fallback = name)
  // Refs marketplaces si ce pays est utilisé comme pays de fabrication.
  // Laisser undefined pour un pays uniquement utilisé en adresse client.
  pfsCountryRef?: string | null;
  efashionProvenanceId?: number | null;
  faireCountryCode?: string | null; // ISO alpha-3
};

export const COUNTRIES: readonly CountryOption[] = [
  { code: "FR", name: "France", nameEn: "France", faireCountryCode: "FRA" },
  { code: "BE", name: "Belgique", nameEn: "Belgium", faireCountryCode: "BEL" },
  { code: "CH", name: "Suisse", nameEn: "Switzerland", faireCountryCode: "CHE" },
  { code: "LU", name: "Luxembourg", nameEn: "Luxembourg" },
  { code: "MC", name: "Monaco", nameEn: "Monaco" },
  { code: "DE", name: "Allemagne", nameEn: "Germany", faireCountryCode: "DEU" },
  { code: "ES", name: "Espagne", nameEn: "Spain", faireCountryCode: "ESP" },
  { code: "IT", name: "Italie", nameEn: "Italy", faireCountryCode: "ITA" },
  { code: "PT", name: "Portugal", nameEn: "Portugal", faireCountryCode: "PRT" },
  { code: "NL", name: "Pays-Bas", nameEn: "Netherlands", faireCountryCode: "NLD" },
  { code: "GB", name: "Royaume-Uni", nameEn: "United Kingdom", faireCountryCode: "GBR" },
  { code: "IE", name: "Irlande", nameEn: "Ireland", faireCountryCode: "IRL" },
  { code: "AT", name: "Autriche", nameEn: "Austria", faireCountryCode: "AUT" },
  { code: "DK", name: "Danemark", nameEn: "Denmark", faireCountryCode: "DNK" },
  { code: "SE", name: "Suède", nameEn: "Sweden", faireCountryCode: "SWE" },
  { code: "NO", name: "Norvège", nameEn: "Norway", faireCountryCode: "NOR" },
  { code: "FI", name: "Finlande", nameEn: "Finland", faireCountryCode: "FIN" },
  { code: "IS", name: "Islande", nameEn: "Iceland" },
  { code: "PL", name: "Pologne", nameEn: "Poland", faireCountryCode: "POL" },
  { code: "CZ", name: "République tchèque", nameEn: "Czech Republic", faireCountryCode: "CZE" },
  { code: "SK", name: "Slovaquie", nameEn: "Slovakia" },
  { code: "HU", name: "Hongrie", nameEn: "Hungary" },
  { code: "RO", name: "Roumanie", nameEn: "Romania", faireCountryCode: "ROU" },
  { code: "BG", name: "Bulgarie", nameEn: "Bulgaria" },
  { code: "GR", name: "Grèce", nameEn: "Greece", faireCountryCode: "GRC" },
  { code: "HR", name: "Croatie", nameEn: "Croatia" },
  { code: "SI", name: "Slovénie", nameEn: "Slovenia" },
  { code: "EE", name: "Estonie", nameEn: "Estonia" },
  { code: "LV", name: "Lettonie", nameEn: "Latvia" },
  { code: "LT", name: "Lituanie", nameEn: "Lithuania" },
  { code: "MT", name: "Malte", nameEn: "Malta" },
  { code: "CY", name: "Chypre", nameEn: "Cyprus" },
  { code: "US", name: "États-Unis", nameEn: "United States", faireCountryCode: "USA" },
  { code: "CA", name: "Canada", nameEn: "Canada", faireCountryCode: "CAN" },
  { code: "MX", name: "Mexique", nameEn: "Mexico", faireCountryCode: "MEX" },
  { code: "BR", name: "Brésil", nameEn: "Brazil", faireCountryCode: "BRA" },
  { code: "AR", name: "Argentine", nameEn: "Argentina", faireCountryCode: "ARG" },
  { code: "CL", name: "Chili", nameEn: "Chile" },
  { code: "CO", name: "Colombie", nameEn: "Colombia" },
  { code: "MA", name: "Maroc", nameEn: "Morocco", faireCountryCode: "MAR" },
  { code: "DZ", name: "Algérie", nameEn: "Algeria" },
  { code: "TN", name: "Tunisie", nameEn: "Tunisia", faireCountryCode: "TUN" },
  { code: "EG", name: "Égypte", nameEn: "Egypt", faireCountryCode: "EGY" },
  { code: "SN", name: "Sénégal", nameEn: "Senegal" },
  { code: "CI", name: "Côte d'Ivoire", nameEn: "Ivory Coast" },
  { code: "ZA", name: "Afrique du Sud", nameEn: "South Africa" },
  { code: "TR", name: "Turquie", nameEn: "Turkey", faireCountryCode: "TUR" },
  { code: "IL", name: "Israël", nameEn: "Israel", faireCountryCode: "ISR" },
  { code: "AE", name: "Émirats arabes unis", nameEn: "United Arab Emirates", faireCountryCode: "ARE" },
  { code: "SA", name: "Arabie saoudite", nameEn: "Saudi Arabia" },
  { code: "QA", name: "Qatar", nameEn: "Qatar" },
  { code: "LB", name: "Liban", nameEn: "Lebanon" },
  { code: "JO", name: "Jordanie", nameEn: "Jordan" },
  { code: "IN", name: "Inde", nameEn: "India", faireCountryCode: "IND" },
  {
    code: "CN",
    name: "Chine",
    nameEn: "China",
    pfsCountryRef: "Chine",
    efashionProvenanceId: 1,
    faireCountryCode: "CHN",
  },
  { code: "JP", name: "Japon", nameEn: "Japan", faireCountryCode: "JPN" },
  { code: "KR", name: "Corée du Sud", nameEn: "South Korea", faireCountryCode: "KOR" },
  { code: "TH", name: "Thaïlande", nameEn: "Thailand", faireCountryCode: "THA" },
  { code: "VN", name: "Vietnam", nameEn: "Vietnam", faireCountryCode: "VNM" },
  { code: "ID", name: "Indonésie", nameEn: "Indonesia", faireCountryCode: "IDN" },
  { code: "SG", name: "Singapour", nameEn: "Singapore" },
  { code: "MY", name: "Malaisie", nameEn: "Malaysia", faireCountryCode: "MYS" },
  { code: "PH", name: "Philippines", nameEn: "Philippines", faireCountryCode: "PHL" },
  { code: "AU", name: "Australie", nameEn: "Australia", faireCountryCode: "AUS" },
  { code: "NZ", name: "Nouvelle-Zélande", nameEn: "New Zealand", faireCountryCode: "NZL" },
  { code: "RU", name: "Russie", nameEn: "Russia" },
  { code: "UA", name: "Ukraine", nameEn: "Ukraine" },
  { code: "RS", name: "Serbie", nameEn: "Serbia" },
  { code: "BA", name: "Bosnie-Herzégovine", nameEn: "Bosnia and Herzegovina" },
  { code: "AL", name: "Albanie", nameEn: "Albania" },
  { code: "MK", name: "Macédoine du Nord", nameEn: "North Macedonia" },
  { code: "ME", name: "Monténégro", nameEn: "Montenegro" },
  { code: "MD", name: "Moldavie", nameEn: "Moldova" },
  { code: "GE", name: "Géorgie", nameEn: "Georgia" },
  { code: "AM", name: "Arménie", nameEn: "Armenia" },
  { code: "HK", name: "Hong Kong", nameEn: "Hong Kong", faireCountryCode: "HKG" },
  { code: "TW", name: "Taïwan", nameEn: "Taiwan", faireCountryCode: "TWN" },
  { code: "BD", name: "Bangladesh", nameEn: "Bangladesh", faireCountryCode: "BGD" },
  { code: "PK", name: "Pakistan", nameEn: "Pakistan", faireCountryCode: "PAK" },
  { code: "RE", name: "La Réunion", nameEn: "Réunion" },
  { code: "MQ", name: "Martinique", nameEn: "Martinique" },
  { code: "GP", name: "Guadeloupe", nameEn: "Guadeloupe" },
  { code: "GF", name: "Guyane française", nameEn: "French Guiana" },
  { code: "YT", name: "Mayotte", nameEn: "Mayotte" },
  { code: "NC", name: "Nouvelle-Calédonie", nameEn: "New Caledonia" },
  { code: "PF", name: "Polynésie française", nameEn: "French Polynesia" },
  { code: "MU", name: "Île Maurice", nameEn: "Mauritius" },
  { code: "PR", name: "Porto Rico", nameEn: "Puerto Rico" },
  { code: "MF", name: "Saint-Martin (partie française)", nameEn: "Saint Martin" },
  { code: "WF", name: "Wallis-et-Futuna", nameEn: "Wallis and Futuna" },
  { code: "AD", name: "Andorre", nameEn: "Andorra" },
  { code: "SM", name: "Saint-Marin", nameEn: "San Marino" },
  { code: "VA", name: "Vatican", nameEn: "Vatican City" },
];

const COUNTRY_BY_CODE = new Map(COUNTRIES.map((c) => [c.code, c]));

/**
 * Normalise un libellé pays pour lookup : uppercase, sans accents,
 * sans espaces, tirets, parenthèses ou apostrophes.
 * "SAINT-MARTIN (FRANÇAIS)" → "SAINTMARTINFRANCAIS"
 * "États-Unis" → "ETATSUNIS"
 */
function normalizeCountryLabel(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "");
}

const COUNTRY_BY_NORMALIZED_NAME = new Map<string, string>();
for (const c of COUNTRIES) {
  COUNTRY_BY_NORMALIZED_NAME.set(normalizeCountryLabel(c.name), c.code);
}

// Alias explicites pour les libellés remontés par PFS (et autres sources externes)
// qui divergent du nom canonique de COUNTRIES après normalisation.
const COUNTRY_NAME_ALIASES: Record<string, string> = {
  REUNION: "RE", // canonique = "La Réunion" → "LAREUNION"
  SAINTMARTIN: "MF",
  SAINTMARTINFRANCAIS: "MF", // libellé PFS "SAINT-MARTIN (FRANÇAIS)"
  ANGLETERRE: "GB",
  GRANDEBRETAGNE: "GB",
  ETATSUNISDAMERIQUE: "US",
  USA: "US",
  UK: "GB",
  COREE: "KR",
  TCHEQUIE: "CZ",
  MACEDOINE: "MK",
  BIRMANIE: "MM",
  IRAN: "IR",
  IRAQ: "IQ",
  KOWEIT: "KW",
  OMAN: "OM",
  BAHREIN: "BH",
  YEMEN: "YE",
  SYRIE: "SY",
  PAKISTAN: "PK",
  BANGLADESH: "BD",
  SRILANKA: "LK",
  NEPAL: "NP",
  TAIWAN: "TW",
  HONGKONG: "HK",
  KAZAKHSTAN: "KZ",
  OUZBEKISTAN: "UZ",
};

/**
 * Résout un input pays (code ISO alpha-2 OU nom en clair) vers son code ISO.
 * Retourne null si non résolvable.
 *
 * Utile pour tolérer les données historiques qui stockaient le nom brut
 * remonté par PFS ("PORTUGAL", "SUISSE") au lieu du code ISO.
 */
export function resolveCountryCode(input: string | null | undefined): string | null {
  if (!input) return null;
  const trimmed = String(input).trim();
  if (!trimmed) return null;

  // Cas 1 : ISO alpha-2 valide direct
  if (trimmed.length === 2) {
    const upper = trimmed.toUpperCase();
    if (COUNTRY_BY_CODE.has(upper)) return upper;
  }

  // Cas 2 : nom normalisé matche un pays de la liste
  const norm = normalizeCountryLabel(trimmed);
  const direct = COUNTRY_BY_NORMALIZED_NAME.get(norm);
  if (direct) return direct;

  // Cas 3 : alias explicite
  const aliased = COUNTRY_NAME_ALIASES[norm];
  if (aliased) return aliased;

  return null;
}

export function findCountry(input: string | null | undefined): CountryOption | null {
  const code = resolveCountryCode(input);
  return code ? COUNTRY_BY_CODE.get(code) ?? null : null;
}

export function countryName(input: string | null | undefined): string {
  return findCountry(input)?.name ?? "";
}

export function countryFlagUrl(input: string, size: 20 | 40 | 80 | 160 = 40): string {
  const code = resolveCountryCode(input) ?? input;
  return `https://flagcdn.com/w${size}/${code.toLowerCase()}.png`;
}

export function isKnownCountry(input: string): boolean {
  return resolveCountryCode(input) !== null;
}

/**
 * Retourne le libellé du pays dans la locale demandée (fallback FR).
 */
export function countryLabel(
  input: string | null | undefined,
  locale: "fr" | "en" = "fr",
): string {
  const c = findCountry(input);
  if (!c) return "";
  if (locale === "en") return c.nameEn ?? c.name;
  return c.name;
}

const COUNTRY_BY_PFS_REF = new Map<string, CountryOption>();
for (const c of COUNTRIES) {
  if (c.pfsCountryRef) COUNTRY_BY_PFS_REF.set(c.pfsCountryRef, c);
}

/**
 * Retrouve un pays par son code ISO alpha-2 (ex: "CN"). Alias de `findCountry`
 * pour la clarté quand on part explicitement d'un code ISO en base.
 */
export function getCountryByIso(input: string | null | undefined): CountryOption | null {
  if (!input) return null;
  const trimmed = String(input).trim();
  if (!trimmed) return null;
  const upper = trimmed.toUpperCase();
  return COUNTRY_BY_CODE.get(upper) ?? null;
}

/**
 * Retrouve un pays via sa référence côté API Paris Fashion Shop
 * (typiquement le libellé FR renvoyé par PFS).
 */
export function getCountryByPfsRef(ref: string | null | undefined): CountryOption | null {
  if (!ref) return null;
  return COUNTRY_BY_PFS_REF.get(ref) ?? null;
}

/**
 * Liste des pays configurés comme pays de fabrication (au moins une ref
 * marketplace renseignée). Utile pour les sélecteurs admin des fiches produit.
 */
export function listManufacturingCountries(): CountryOption[] {
  return COUNTRIES.filter(
    (c) =>
      c.pfsCountryRef != null ||
      c.efashionProvenanceId != null ||
      c.faireCountryCode != null,
  );
}
