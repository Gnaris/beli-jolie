/**
 * Liste des pays supportés dans les fiches client admin.
 * Code ISO 3166-1 alpha-2 (2 lettres) + libellé FR.
 * Drapeau servi par https://flagcdn.com (PNG public, gratuit).
 */

export type CountryOption = {
  code: string; // ISO 3166-1 alpha-2 (ex. "FR")
  name: string; // Libellé FR
};

export const COUNTRIES: readonly CountryOption[] = [
  { code: "FR", name: "France" },
  { code: "BE", name: "Belgique" },
  { code: "CH", name: "Suisse" },
  { code: "LU", name: "Luxembourg" },
  { code: "MC", name: "Monaco" },
  { code: "DE", name: "Allemagne" },
  { code: "ES", name: "Espagne" },
  { code: "IT", name: "Italie" },
  { code: "PT", name: "Portugal" },
  { code: "NL", name: "Pays-Bas" },
  { code: "GB", name: "Royaume-Uni" },
  { code: "IE", name: "Irlande" },
  { code: "AT", name: "Autriche" },
  { code: "DK", name: "Danemark" },
  { code: "SE", name: "Suède" },
  { code: "NO", name: "Norvège" },
  { code: "FI", name: "Finlande" },
  { code: "IS", name: "Islande" },
  { code: "PL", name: "Pologne" },
  { code: "CZ", name: "République tchèque" },
  { code: "SK", name: "Slovaquie" },
  { code: "HU", name: "Hongrie" },
  { code: "RO", name: "Roumanie" },
  { code: "BG", name: "Bulgarie" },
  { code: "GR", name: "Grèce" },
  { code: "HR", name: "Croatie" },
  { code: "SI", name: "Slovénie" },
  { code: "EE", name: "Estonie" },
  { code: "LV", name: "Lettonie" },
  { code: "LT", name: "Lituanie" },
  { code: "MT", name: "Malte" },
  { code: "CY", name: "Chypre" },
  { code: "US", name: "États-Unis" },
  { code: "CA", name: "Canada" },
  { code: "MX", name: "Mexique" },
  { code: "BR", name: "Brésil" },
  { code: "AR", name: "Argentine" },
  { code: "CL", name: "Chili" },
  { code: "CO", name: "Colombie" },
  { code: "MA", name: "Maroc" },
  { code: "DZ", name: "Algérie" },
  { code: "TN", name: "Tunisie" },
  { code: "EG", name: "Égypte" },
  { code: "SN", name: "Sénégal" },
  { code: "CI", name: "Côte d'Ivoire" },
  { code: "ZA", name: "Afrique du Sud" },
  { code: "TR", name: "Turquie" },
  { code: "IL", name: "Israël" },
  { code: "AE", name: "Émirats arabes unis" },
  { code: "SA", name: "Arabie saoudite" },
  { code: "QA", name: "Qatar" },
  { code: "LB", name: "Liban" },
  { code: "JO", name: "Jordanie" },
  { code: "IN", name: "Inde" },
  { code: "CN", name: "Chine" },
  { code: "JP", name: "Japon" },
  { code: "KR", name: "Corée du Sud" },
  { code: "TH", name: "Thaïlande" },
  { code: "VN", name: "Vietnam" },
  { code: "ID", name: "Indonésie" },
  { code: "SG", name: "Singapour" },
  { code: "MY", name: "Malaisie" },
  { code: "PH", name: "Philippines" },
  { code: "AU", name: "Australie" },
  { code: "NZ", name: "Nouvelle-Zélande" },
  { code: "RU", name: "Russie" },
  { code: "UA", name: "Ukraine" },
  { code: "RS", name: "Serbie" },
  { code: "BA", name: "Bosnie-Herzégovine" },
  { code: "AL", name: "Albanie" },
  { code: "MK", name: "Macédoine du Nord" },
  { code: "ME", name: "Monténégro" },
  { code: "MD", name: "Moldavie" },
  { code: "GE", name: "Géorgie" },
  { code: "AM", name: "Arménie" },
  { code: "RE", name: "La Réunion" },
  { code: "MQ", name: "Martinique" },
  { code: "GP", name: "Guadeloupe" },
  { code: "GF", name: "Guyane française" },
  { code: "YT", name: "Mayotte" },
  { code: "NC", name: "Nouvelle-Calédonie" },
  { code: "PF", name: "Polynésie française" },
  { code: "AD", name: "Andorre" },
  { code: "SM", name: "Saint-Marin" },
  { code: "VA", name: "Vatican" },
];

const COUNTRY_BY_CODE = new Map(COUNTRIES.map((c) => [c.code, c]));

export function findCountry(code: string | null | undefined): CountryOption | null {
  if (!code) return null;
  return COUNTRY_BY_CODE.get(code.toUpperCase()) ?? null;
}

export function countryName(code: string | null | undefined): string {
  return findCountry(code)?.name ?? "";
}

export function countryFlagUrl(code: string, size: 20 | 40 | 80 | 160 = 40): string {
  return `https://flagcdn.com/w${size}/${code.toLowerCase()}.png`;
}

export function isKnownCountry(code: string): boolean {
  return COUNTRY_BY_CODE.has(code.toUpperCase());
}
