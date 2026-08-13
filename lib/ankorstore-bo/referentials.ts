/**
 * Référentiels Ankorstore hardcodés (extraits du HAR "check ankorstore.har").
 *
 * Ces IDs sont stables côté Ankorstore. Si un jour on découvre qu'ils bougent,
 * ajouter un fetch runtime + cache 24h via unstable_cache.
 */

/** Tags produit — reçus de GET /api/global-config, embarqués. */
export const ANKORSTORE_TAG_IDS = {
  /** "Se conserve au frais" — alimentaire */
  FRESH_PRODUCT: 1,
  /** "Produit surgelé" — alimentaire */
  FROZEN_PRODUCT: 2,
  ORGANIC: 3,
  HANDMADE: 4,
  ECO_FRIENDLY: 5,
  ZERO_WASTE: 6,
  CRUELTY_FREE: 7,
  /** ⭐ Le tag qui rend un produit "Bestseller" côté Ankor. */
  BESTSELLER: 8,
  VEGAN: 9,
  CONTAINS_ALCOHOL: 10,
} as const;

/** Types d'options variantes — reçus de GET /api/me/brand/products/variants-presets. */
export const ANKORSTORE_OPTION_IDS = {
  SIZE: 1,
  COLOR: 2,
  OTHER: 3,
} as const;

/**
 * ID pays Ankorstore → code ISO.
 * Table extraite de GET /api/countries (validée via
 * scripts/ankorstore-fetch-countries.ts le 2026-08-13).
 * Sélectionne uniquement les codes qu'on va vraiment utiliser côté BJ/Issyma.
 */
export const ANKORSTORE_COUNTRY_ISO_TO_ID: Record<string, number> = {
  FR: 76, // France
  CN: 46, // Chine
  IN: 103, // Inde
  IT: 110, // Italie
  ES: 209, // Espagne
  DE: 83, // Allemagne
  PT: 178, // Portugal
  TR: 228, // Turquie
  MA: 151, // Maroc
  TN: 227, // Tunisie
  BE: 22, // Belgique
  NL: 157, // Pays-Bas
  PL: 177, // Pologne
  GB: 235, // Royaume-Uni
  US: 236, // États-Unis
  JP: 112, // Japon
  KR: 119, // Corée du Sud
  VN: 242, // Vietnam
  TH: 221, // Thaïlande
  MX: 144, // Mexique
  BR: 32, // Brésil
  ID: 104, // Indonésie
  BD: 19, // Bangladesh
  PK: 168, // Pakistan
  PE: 174, // Pérou
  EG: 66, // Égypte
  GR: 86, // Grèce
  IE: 107, // Irlande
  CH: 216, // Suisse
  AT: 15, // Autriche
  DK: 61, // Danemark
  SE: 215, // Suède
  NO: 166, // Norvège
  FI: 75, // Finlande
  CZ: 60, // Tchéquie
  RO: 182, // Roumanie
  BG: 35, // Bulgarie
  HU: 101, // Hongrie
  SK: 202, // Slovaquie
  HR: 56, // Croatie
  RS: 197, // Serbie
  LV: 123, // Lettonie
  LT: 129, // Lituanie
  EE: 70, // Estonie
  SI: 203, // Slovénie
  LU: 130, // Luxembourg
  MT: 138, // Malte
  CY: 59, // Chypre
  IS: 102, // Islande
  AU: 14, // Australie
  NZ: 159, // Nouvelle-Zélande
  CA: 40, // Canada
  AR: 11, // Argentine
  CL: 45, // Chili
  CO: 49, // Colombie
  ZA: 206, // Afrique du Sud
};

/** Fallback quand aucun ISO ne matche : Chine (le plus fréquent chez BJ). */
export const ANKORSTORE_DEFAULT_COUNTRY_ID = ANKORSTORE_COUNTRY_ISO_TO_ID.CN;

/** Convertit un ISO alpha-2 en id Ankor. Retourne le fallback CN si inconnu. */
export function ankorstoreCountryIdFromIso(iso: string | null | undefined): number {
  if (!iso) return ANKORSTORE_DEFAULT_COUNTRY_ID;
  const upper = iso.toUpperCase();
  return ANKORSTORE_COUNTRY_ISO_TO_ID[upper] ?? ANKORSTORE_DEFAULT_COUNTRY_ID;
}

/** Convertit une TVA BJ (%) en valeur acceptée par Ankor. */
export function ankorstoreVatRate(rate: number): number {
  // Ankor accepte 0, 5, 10, 20 (variables selon pays). Normalise si arrondi bizarre.
  if (rate <= 0) return 0;
  if (rate < 6) return 5;
  if (rate < 15) return 10;
  return 20;
}
